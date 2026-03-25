# ============================================================
# STEP 5 — Inference: Predict on New Complaints
# Run: python step5_predict.py
# Uses the faster TF-IDF model by default.
# Switch to BERT by setting USE_BERT = True (requires step4)
# ============================================================

import json
import re
import nltk
import joblib
import torch
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer

nltk.download('stopwords', quiet=True)
nltk.download('wordnet',   quiet=True)

USE_BERT = False   # ← set True to use fine-tuned BERT instead

# ── Label map ────────────────────────────────────────────────
with open("data/label_map.json") as f:
    maps = json.load(f)
label2id = maps['label2id']
id2label = {int(k): v for k, v in maps['id2label'].items()}

# ── Preprocessing (same pipeline as step2) ──────────────────
stop_words  = set(stopwords.words('english'))
lemmatizer  = WordNetLemmatizer()

def clean_text(text: str) -> str:
    text = str(text).lower()
    text = re.sub(r'http\S+|www\S+', '', text)
    text = re.sub(r'[^a-z\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    tokens = [
        lemmatizer.lemmatize(tok)
        for tok in text.split()
        if tok not in stop_words and len(tok) > 2
    ]
    return ' '.join(tokens)

# ── Load model ───────────────────────────────────────────────
if USE_BERT:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import numpy as np

    tokenizer = AutoTokenizer.from_pretrained("models/bert_finetuned")
    model     = AutoModelForSequenceClassification.from_pretrained("models/bert_finetuned")
    model.eval()

    def predict(text: str) -> dict:
        cleaned = clean_text(text)
        inputs  = tokenizer(cleaned, return_tensors='pt',
                            truncation=True, max_length=128)
        with torch.no_grad():
            logits = model(**inputs).logits
        probs      = torch.softmax(logits, dim=-1)[0].numpy()
        pred_id    = int(np.argmax(probs))
        confidence = float(probs[pred_id])
        return {
            "complaint"   : text,
            "category"    : id2label[pred_id],
            "confidence"  : round(confidence, 3),
            "all_scores"  : {id2label[i]: round(float(p), 3)
                             for i, p in enumerate(probs)}
        }
else:
    pipeline = joblib.load("models/tfidf_pipeline.pkl")

    def predict(text: str) -> dict:
        cleaned    = clean_text(text)
        pred_id    = int(pipeline.predict([cleaned])[0])
        # get probability scores if available
        try:
            probs      = pipeline.predict_proba([cleaned])[0]
            confidence = float(max(probs))
            all_scores = {id2label[i]: round(float(p), 3)
                          for i, p in enumerate(probs)}
        except AttributeError:
            # LinearSVC doesn't have predict_proba
            confidence = 1.0
            all_scores = {}
        return {
            "complaint" : text,
            "category"  : id2label[pred_id],
            "confidence": round(confidence, 3),
            "all_scores": all_scores
        }

# ── Test with sample complaints ──────────────────────────────
test_complaints = [
    "The road near my house has a huge pothole that damaged my bike",
    "Garbage has not been collected for 10 days, smell is unbearable",
    "Sewage water is overflowing onto the footpath near ward 7",
    "There is no electricity in our colony for the past 2 days",
    "The government school teacher is absent every other day",
    "Tap water supply has been cut off for 5 days in our area",
    "The health centre has no medicines available for patients",
    "My ration card application has been pending for 6 months",
]

print("=" * 65)
print("COMPLAINT CLASSIFIER — INFERENCE")
print(f"Model: {'BERT (fine-tuned)' if USE_BERT else 'TF-IDF + Logistic Regression'}")
print("=" * 65)

for complaint in test_complaints:
    result = predict(complaint)
    print(f"\nComplaint  : {result['complaint']}")
    print(f"Predicted  : {result['category']}  (confidence: {result['confidence']:.0%})")
    if result['all_scores']:
        top3 = sorted(result['all_scores'].items(), key=lambda x: -x[1])[:3]
        print(f"Top-3 cats : {' | '.join(f'{k}: {v:.0%}' for k,v in top3)}")

print("\n" + "=" * 65)
print("Predict your own complaint:")
print("  result = predict('your complaint text here')")
print("  print(result)")