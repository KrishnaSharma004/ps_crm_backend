#!/usr/bin/env python
"""Evaluate checkpoint accuracy on test set."""
import os
import torch
import torch.nn as nn
import numpy as np
import pandas as pd
from pathlib import Path
from PIL import Image
from torchvision import transforms, models
from torch.utils.data import DataLoader, Dataset
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, classification_report
from tqdm import tqdm

# Device
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Model class
class ImageClassificationModel(nn.Module):
    def __init__(self, num_classes=7, pretrained=True):
        super(ImageClassificationModel, self).__init__()
        self.backbone = models.resnet50(pretrained=pretrained)
        for param in self.backbone.parameters():
            param.requires_grad = False
        num_ftrs = self.backbone.fc.in_features
        self.backbone.fc = nn.Sequential(
            nn.Linear(num_ftrs, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, num_classes)
        )
    def forward(self, x):
        return self.backbone(x)

# Dataset class
class CustomImageDataset(Dataset):
    def __init__(self, dataframe, transform=None):
        self.dataframe = dataframe
        self.transform = transform
    def __len__(self):
        return len(self.dataframe)
    def __getitem__(self, idx):
        img_path = self.dataframe.iloc[idx]['image_path']
        label = self.dataframe.iloc[idx]['label_encoded']
        image = Image.open(img_path).convert('RGB')
        if self.transform:
            image = self.transform(image)
        return image, torch.tensor(label, dtype=torch.long)

# Load dataset
print("Loading dataset...")
dataset_root = Path(r'd:\dl+nlp\archive (2)\data')
image_paths = []
labels = []
for class_dir in sorted(dataset_root.rglob('*')):
    if class_dir.is_dir() and any(class_dir.glob('*.jpg')):
        class_name = class_dir.name
        for img_path in class_dir.glob('*.jpg'):
            image_paths.append(str(img_path))
            labels.append(class_name)

df = pd.DataFrame({'image_path': image_paths, 'label': labels})
print(f"Total images: {len(df)}")

# Encode labels
label_encoder = LabelEncoder()
df['label_encoded'] = label_encoder.fit_transform(df['label'])
class_names_sorted = label_encoder.classes_
num_classes = len(class_names_sorted)

# Create splits (same as notebook)
train_df, temp_df = train_test_split(df, test_size=0.3, random_state=42, stratify=df['label'])
val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=42, stratify=temp_df['label'])

# Data transforms
val_test_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

# Create test loader
test_dataset = CustomImageDataset(test_df, transform=val_test_transform)
test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False, num_workers=2)

# Load model and checkpoint
print(f"Loading model and checkpoint...")
model = ImageClassificationModel(num_classes=num_classes, pretrained=False)
state = torch.load(r'd:\dl+nlp\best_model.pth', map_location=device, weights_only=True)
model.load_state_dict(state)
model = model.to(device)
model.eval()

# Evaluate
print(f"Evaluating on {len(test_df)} test images...")
all_preds = []
all_labels = []
with torch.no_grad():
    for images, labels in tqdm(test_loader, desc='Evaluating', leave=True):
        images = images.to(device)
        labels = labels.to(device)
        outputs = model(images)
        preds = outputs.argmax(dim=1)
        all_preds.extend(preds.cpu().numpy())
        all_labels.extend(labels.cpu().numpy())

y_true = np.array(all_labels)
y_pred = np.array(all_preds)

# Compute metrics
test_accuracy = accuracy_score(y_true, y_pred)
test_precision = precision_score(y_true, y_pred, average='weighted', zero_division=0)
test_recall = recall_score(y_true, y_pred, average='weighted', zero_division=0)
test_f1 = f1_score(y_true, y_pred, average='weighted', zero_division=0)

# Print results
print("\n" + "="*70)
print("TEST SET PERFORMANCE")
print("="*70)
print(f"Accuracy:  {test_accuracy*100:.2f}%")
print(f"Precision: {test_precision*100:.2f}%")
print(f"Recall:    {test_recall*100:.2f}%")
print(f"F1-Score:  {test_f1*100:.2f}%")

if test_accuracy >= 0.90:
    print("\n✓ Model EXCEEDS >90% accuracy requirement!")
else:
    print(f"\n⚠ Model accuracy is {test_accuracy*100:.2f}% (below 90% target)")

print("\n" + "="*70)
print("CLASSIFICATION REPORT BY CLASS")
print("="*70)
print(classification_report(y_true, y_pred, target_names=class_names_sorted, digits=4, zero_division=0))
