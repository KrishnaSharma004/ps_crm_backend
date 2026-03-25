import sys
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
import warnings
warnings.filterwarnings('ignore')

# PyTorch imports
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from torchvision.models import resnet50, efficientnet_b2
from PIL import Image
import json

print(f"PyTorch version: {torch.__version__}")
print(f"GPU Available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")

# ============================================================================
# 1. LOAD AND EXPLORE DATASET
# ============================================================================
print("\n" + "="*70)
print("LOADING DATASET")
print("="*70)

dataset_root = Path(r'd:\dl+nlp\archive (2)\data')

# Collect all image paths and labels
image_paths = []
labels = []
class_counts = {}

for class_dir in sorted(dataset_root.rglob('*')):
    if class_dir.is_dir() and any(class_dir.glob('*.jpg')):
        class_name = class_dir.name
        count = 0
        for img_path in class_dir.glob('*.jpg'):
            image_paths.append(str(img_path))
            labels.append(class_name)
            count += 1
        class_counts[class_name] = count

df = pd.DataFrame({'image_path': image_paths, 'label': labels})
print(f"\nTotal images: {len(df)}")
print(f"Classes: {len(df['label'].unique())}")
print(f"\nClass distribution:")
print(df['label'].value_counts().sort_index())

# Encode labels
label_encoder = LabelEncoder()
df['label_encoded'] = label_encoder.fit_transform(df['label'])
class_names_sorted = label_encoder.classes_
num_classes = len(class_names_sorted)

# Calculate class weights
class_counts_dict = df['label'].value_counts()
class_weights = {}
for idx, class_name in enumerate(class_names_sorted):
    count = len(df[df['label'] == class_name])
    weight = len(df) / (num_classes * count)
    class_weights[idx] = weight

print("\nClass weights:")
for idx, class_name in enumerate(class_names_sorted):
    print(f"  {class_name}: {class_weights[idx]:.3f}")

# Train/Val/Test split (70/15/15)
train_df, temp_df = train_test_split(df, test_size=0.3, random_state=42, stratify=df['label'])
val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=42, stratify=temp_df['label'])

print(f"\nDataset split:")
print(f"  Train: {len(train_df)} ({len(train_df)/len(df)*100:.1f}%)")
print(f"  Val:   {len(val_df)} ({len(val_df)/len(df)*100:.1f}%)")
print(f"  Test:  {len(test_df)} ({len(test_df)/len(df)*100:.1f}%)")

# ============================================================================
# 2. CUSTOM DATASET CLASS
# ============================================================================
IMG_SIZE = 224
BATCH_SIZE = 32
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

class CustomImageDataset(Dataset):
    def __init__(self, df, transform=None):
        self.df = df.reset_index(drop=True)
        self.transform = transform
    
    def __len__(self):
        return len(self.df)
    
    def __getitem__(self, idx):
        img_path = self.df.iloc[idx]['image_path']
        label = self.df.iloc[idx]['label_encoded']
        
        try:
            img = Image.open(img_path).convert('RGB')
        except:
            # If image fails to load, return a blank image
            img = Image.new('RGB', (IMG_SIZE, IMG_SIZE), color=(128, 128, 128))
        
        if self.transform:
            img = self.transform(img)
        
        return img, label

# Data augmentation
train_transform = transforms.Compose([
    transforms.RandomRotation(20),
    transforms.RandomHorizontalFlip(),
    transforms.RandomAffine(degrees=0, translate=(0.2, 0.2), scale=(0.8, 1.2)),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

test_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# Create datasets and dataloaders
train_dataset = CustomImageDataset(train_df, transform=train_transform)
val_dataset = CustomImageDataset(val_df, transform=test_transform)
test_dataset = CustomImageDataset(test_df, transform=test_transform)

train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

print(f"\nDataLoaders created:")
print(f"  Train batches: {len(train_loader)}")
print(f"  Val batches: {len(val_loader)}")
print(f"  Test batches: {len(test_loader)}")

# ============================================================================
# 3. BUILD MODEL
# ============================================================================
print("\n" + "="*70)
print("BUILDING MODEL")
print("="*70)

# Load pre-trained ResNet50
base_model = resnet50(pretrained=True)
base_model.fc = nn.Sequential(
    nn.Linear(base_model.fc.in_features, 512),
    nn.ReLU(),
    nn.Dropout(0.3),
    nn.Linear(512, 256),
    nn.ReLU(),
    nn.Dropout(0.2),
    nn.Linear(256, num_classes)
)

model = base_model.to(DEVICE)

# Calculate total parameters
total_params = sum(p.numel() for p in model.parameters())
trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"\nModel Parameters:")
print(f"  Total: {total_params:,}")
print(f"  Trainable: {trainable_params:,}")

# Loss and optimizer
class_weights_tensor = torch.tensor([class_weights[i] for i in range(num_classes)], dtype=torch.float32).to(DEVICE)
criterion = nn.CrossEntropyLoss(weight=class_weights_tensor)
optimizer = optim.Adam(model.parameters(), lr=0.001)
scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=3, verbose=True)

# ============================================================================
# 4. TRAINING LOOP
# ============================================================================  
print("\n" + "="*70)
print("TRAINING MODEL")
print("="*70)

def train_epoch(model, train_loader, criterion, optimizer):
    model.train()
    total_loss = 0
    correct = 0
    total = 0
    
    for batch_idx, (images, labels) in enumerate(train_loader):
        images, labels = images.to(DEVICE), labels.to(DEVICE)
        
        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()
        
        total_loss += loss.item()
        _, predicted = torch.max(outputs.data, 1)
        total += labels.size(0)
        correct += (predicted == labels).sum().item()
        
        if (batch_idx + 1) % 5 == 0:
            print(f"  Batch {batch_idx + 1}/{len(train_loader)}, Loss: {loss.item():.4f}")
    
    avg_loss = total_loss / len(train_loader)
    accuracy = 100 * correct / total
    return avg_loss, accuracy

def validate(model, val_loader, criterion):
    model.eval()
    total_loss = 0
    correct = 0
    total = 0
    
    with torch.no_grad():
        for images, labels in val_loader:
            images, labels = images.to(DEVICE), labels.to(DEVICE)
            outputs = model(images)
            loss = criterion(outputs, labels)
            
            total_loss += loss.item()
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
    
    avg_loss = total_loss / len(val_loader)
    accuracy = 100 * correct / total
    return avg_loss, accuracy

# Training parameters
num_epochs = 20
best_val_loss = float('inf')
patience = 5
patience_counter = 0

history = {'train_loss': [], 'train_acc': [], 'val_loss': [], 'val_acc': []}

for epoch in range(num_epochs):
    print(f"\nEpoch {epoch + 1}/{num_epochs}")
    
    train_loss, train_acc = train_epoch(model, train_loader, criterion, optimizer)
    val_loss, val_acc = validate(model, val_loader, criterion)
    
    history['train_loss'].append(train_loss)
    history['train_acc'].append(train_acc)
    history['val_loss'].append(val_loss)
    history['val_acc'].append(val_acc)
    
    print(f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.2f}%")
    print(f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.2f}%")
    
    scheduler.step(val_loss)
    
    if val_loss < best_val_loss:
        best_val_loss = val_loss
        patience_counter = 0
        torch.save(model.state_dict(), r'd:\dl+nlp\best_model.pth')
        print(f"✓ Best model saved (Val Loss: {val_loss:.4f})")
    else:
        patience_counter += 1
        if patience_counter >= patience:
            print(f"\nEarly stopping triggered after {epoch + 1} epochs")
            break

print("\n" + "="*70)
print("TRAINING COMPLETED")
print("="*70)

# ============================================================================
# 5. EVALUATION
# ============================================================================
print("\n" + "="*70)
print("EVALUATING MODEL")
print("="*70)

# Load best model
model.load_state_dict(torch.load(r'd:\dl+nlp\best_model.pth'))
model.eval()

# Test set evaluation
all_preds = []
all_labels = []

with torch.no_grad():
    for images, labels in test_loader:
        images = images.to(DEVICE)
        outputs = model(images)
        _, predicted = torch.max(outputs, 1)
        
        all_preds.extend(predicted.cpu().numpy())
        all_labels.extend(labels.cpu().numpy())

all_preds = np.array(all_preds)
all_labels = np.array(all_labels)

# Metrics
test_accuracy = accuracy_score(all_labels, all_preds)
print(f"\nTest Accuracy: {test_accuracy*100:.2f}%")

# Classification report
print(f"\n{'='*70}")
print("Classification Report:")
print(f"{'='*70}")
print(classification_report(all_labels, all_preds, target_names=class_names_sorted, digits=4))

# Confusion matrix
cm = confusion_matrix(all_labels, all_preds)

plt.figure(figsize=(10, 8))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=class_names_sorted, yticklabels=class_names_sorted,
            cbar_kws={'label': 'Count'})
plt.title('Confusion Matrix - Test Set')
plt.ylabel('True Label')
plt.xlabel('Predicted Label')
plt.xticks(rotation=45, ha='right')
plt.yticks(rotation=0)
plt.tight_layout()
plt.savefig(r'd:\dl+nlp\confusion_matrix.png', dpi=150, bbox_inches='tight')
print("✓ Confusion matrix saved.")
plt.show()

# Per-class accuracy
print("\nPer-Class Accuracy:")
for i, class_name in enumerate(class_names_sorted):
    class_accuracy = cm[i, i] / cm[i].sum() if cm[i].sum() > 0 else 0
    print(f"  {class_name}: {class_accuracy*100:.2f}%")

# ============================================================================
# 6. SAVE MODEL AND METADATA
# ============================================================================
print("\n" + "="*70)
print("SAVING MODEL")
print("="*70)

torch.save(model.state_dict(), r'd:\dl+nlp\fault_classification_model_final.pth')

# Save metadata
metadata = {
    'classes': class_names_sorted.tolist(),
    'img_size': IMG_SIZE,
    'test_accuracy': float(test_accuracy),
    'total_params': int(total_params),
    'total_images': len(df),
    'test_images': len(test_df),
    'architecture': 'ResNet50'
}

with open(r'd:\dl+nlp\model_metadata.json', 'w') as f:
    json.dump(metadata, f, indent=2)

print("\nModel saved successfully!")
print(f"  - Model weights: fault_classification_model_final.pth")
print(f"  - Metadata: model_metadata.json")
print(f"\nFinal Test Accuracy: {test_accuracy*100:.2f}%")
if test_accuracy >= 0.90:
    print("✓ Model meets >90% accuracy requirement!")
else:
    print(f"⚠ Model accuracy is {test_accuracy*100:.2f}%. Consider fine-tuning with more epochs.")

# Plot training history
plt.figure(figsize=(14, 5))

plt.subplot(1, 2, 1)
plt.plot(history['train_acc'], label='Train Accuracy', linewidth=2)
plt.plot(history['val_acc'], label='Val Accuracy', linewidth=2)
plt.xlabel('Epoch')
plt.ylabel('Accuracy (%)')
plt.title('Model Accuracy Over Epochs')
plt.legend()
plt.grid(True, alpha=0.3)

plt.subplot(1, 2, 2)
plt.plot(history['train_loss'], label='Train Loss', linewidth=2)
plt.plot(history['val_loss'], label='Val Loss', linewidth=2)
plt.xlabel('Epoch')
plt.ylabel('Loss')
plt.title('Model Loss Over Epochs')
plt.legend()
plt.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig(r'd:\dl+nlp\training_history.png', dpi=150, bbox_inches='tight')
print("\n✓ Training history plot saved.")
plt.show()
