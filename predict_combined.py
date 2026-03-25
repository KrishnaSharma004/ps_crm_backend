import json
import re
import warnings
import torch
import torch.nn as nn
import cv2 # Make sure you have opencv-python installed if you prefer cv2, but PIL is safer
from PIL import Image
from torchvision import transforms, models
import joblib
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer

warnings.filterwarnings('ignore')

# ============================================================================
# 1. SETUP NLP MODEL (TF-IDF / BERT)
# ============================================================================
USE_BERT = False  # Set to True to use BERT instead of TF-IDF

# Load Text Labels
with open("data/label_map.json") as f:
    maps = json.load(f)
text_id2label = {int(k): v for k, v in maps['id2label'].items()}

# Set up text cleaner
stop_words = set(stopwords.words('english'))
lemmatizer = WordNetLemmatizer()

def clean_text(text: str) -> str:
    text = str(text).lower()
    text = re.sub(r'http\S+|www\S+', '', text)
    text = re.sub(r'[^a-z\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return ' '.join([lemmatizer.lemmatize(t) for t in text.split() if t not in stop_words and len(t) > 2])

# Load Text Model
if USE_BERT:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import numpy as np
    text_tokenizer = AutoTokenizer.from_pretrained("models/bert_finetuned")
    text_model = AutoModelForSequenceClassification.from_pretrained("models/bert_finetuned")
    text_model.eval()
else:
    text_pipeline = joblib.load("models/tfidf_pipeline.pkl")


# ============================================================================
# 2. SETUP IMAGE CLASSIFICATION MODEL (PyTorch)
# ============================================================================
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

class ImageClassificationModel(nn.Module):
    def __init__(self, num_classes=7, pretrained=False):
        super(ImageClassificationModel, self).__init__()
        self.backbone = models.resnet50(pretrained=pretrained)
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

# NOTE: This corresponds to best_model_finetuned.pth which achieved ~93% accuracy
image_classes = [
    "Broken Road Sign Issues",
    "Damaged Road issues",
    "Damaged concrete structures",
    "Illegal Parking Issues",
    "Littering Garbage on Public Places Issues",
    "Mixed Issues",
    "Pothole Issues",
    "Vandalism Issues"
]
image_model = ImageClassificationModel(num_classes=len(image_classes), pretrained=False)

try:
    # Loading the $\gt$93% accuracy model
    state = torch.load(r'dl+nlp/best_model_finetuned.pth', map_location=device, weights_only=True)
    # The finetuned state was saved including the 'backbone.' prefix
    image_model.load_state_dict(state)
    image_model = image_model.to(device)
    image_model.eval()
    image_model_loaded = True
except Exception as e:
    print(f"Warning: Image model could not be loaded. Please check the path and classes. Error: {e}")
    image_model_loaded = False

# Same transforms utilized during training
img_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


# ============================================================================
# 3. COMBINED INFERENCE PIPELINE
# ============================================================================
def predict_multimodal(text: str, image_path: str = None) -> dict:
    results = {}
    
    # --- TEXT PREDICTION ---
    if text:
        cleaned = clean_text(text)
        if USE_BERT:
            inputs = text_tokenizer(cleaned, return_tensors='pt', truncation=True, max_length=128)
            with torch.no_grad():
                logits = text_model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)[0].numpy()
            pred_id = int(np.argmax(probs))
            results['text_prediction'] = {
                "category": text_id2label[pred_id],
                "confidence": float(probs[pred_id])
            }
        else:
            pred_id = int(text_pipeline.predict([cleaned])[0])
            try:
                probs = text_pipeline.predict_proba([cleaned])[0]
                confidence = float(max(probs))
            except:
                confidence = 1.0
            results['text_prediction'] = {
                "category": text_id2label[pred_id],
                "confidence": confidence
            }
            
    # --- IMAGE PREDICTION ---
    if image_path and image_model_loaded:
        try:
            image = Image.open(image_path).convert('RGB')
            tensor = img_transform(image).unsqueeze(0).to(device) # Add batch dimension
            
            with torch.no_grad():
                outputs = image_model(tensor)
                probs = torch.softmax(outputs, dim=1)[0]
                pred_idx = torch.argmax(probs).item()
                
            results['image_prediction'] = {
                "category": image_classes[pred_idx],
                "confidence": float(probs[pred_idx])
            }
        except Exception as e:
            results['image_prediction'] = {"error": str(e)}

    return results

# ============================================================================
# 4. TEST IT
# ============================================================================
if __name__ == "__main__":
    print("-" * 60)
    print("STARTING MULTIMODAL COMPLAINT PIPELINE DEMO")
    print("-" * 60)
    
    # Dummy Complaint Details
    sample_text = "I want to report a huge pothole on 5th Avenue causing traffic issues and damaging car suspensions."
    sample_image = r"dl+nlp\archive (2)\data\Road Issues\Pothole Issues\101_jpg.rf.355f5220e8c24731cb65c7a6ead7a68f.jpg"
    
    print(f"\n[1] NEW COMPLAINT RECEIVED:")
    print(f"    Text  : '{sample_text}'")
    print(f"    Image : {sample_image}")
    
    print("\n[2] RUNNING INFERENCE (NLP & VISION)...")
    output = predict_multimodal(sample_text, sample_image)
    
    print("\n[3] PIPELINE OUTPUT RESULTS (JSON):")
    print(json.dumps(output, indent=4))
    
    print("\n" + "-" * 60)
    print("COMPLAINT SUCCESSFULLY PROCESSED!")
    print("-" * 60)
