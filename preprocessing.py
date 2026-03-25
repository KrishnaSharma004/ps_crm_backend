# ============================================================
# STEP 2 — Text Preprocessing
# Run: python step2_preprocess.py
# ============================================================

import pandas as pd
import re
import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer

# ── Download NLTK resources (first run only) ─────────────────
print("Downloading NLTK resources...")
nltk.download('stopwords',   quiet=True)
nltk.download('wordnet',     quiet=True)
nltk.download('omw-1.4',     quiet=True)

stop_words  = set(stopwords.words('english'))
lemmatizer  = WordNetLemmatizer()

# ── Load raw dataset ─────────────────────────────────────────
df = pd.read_excel(r"C:\Users\samik\OneDrive\Desktop\hackathon\government_complaints_dataset.xlsx")
print(f"Loaded {len(df)} complaints")

# ── Label encoding ───────────────────────────────────────────
# We classify at the Category level (7 classes)
categories  = sorted(df['Category'].unique())
label2id    = {cat: idx for idx, cat in enumerate(categories)}
id2label    = {idx: cat for cat, idx in label2id.items()}

df['label']     = df['Category'].map(label2id)
df['label_name']= df['Category']   # keep human-readable copy

print("\nLabel mapping:")
for cat, idx in label2id.items():
    print(f"  {idx} → {cat}")

# ── Text cleaning function ───────────────────────────────────
def clean_text(text: str) -> str:
    text = str(text).lower()                          # lowercase
    text = re.sub(r'http\S+|www\S+', '', text)        # remove URLs
    text = re.sub(r'[^a-z\s]', ' ', text)            # keep only letters
    text = re.sub(r'\s+', ' ', text).strip()          # collapse whitespace
    tokens = text.split()
    tokens = [
        lemmatizer.lemmatize(tok)
        for tok in tokens
        if tok not in stop_words and len(tok) > 2    # drop stopwords & tiny tokens
    ]
    return ' '.join(tokens)

# ── Apply cleaning ───────────────────────────────────────────
df['clean_text'] = df['Complaint Text'].apply(clean_text)

# ── Quality check ────────────────────────────────────────────
print("\nBefore vs After cleaning (3 examples):")
print("-" * 60)
for i in [0, 25, 80]:
    print(f"RAW  : {df['Complaint Text'].iloc[i]}")
    print(f"CLEAN: {df['clean_text'].iloc[i]}")
    print()

# ── Save processed data ──────────────────────────────────────
output_cols = ['Complaint Text', 'clean_text', 'Category',
               'Subcategory', 'label', 'label_name']
import os

# Ensure 'data' folder exists
os.makedirs("data", exist_ok=True)

df.to_csv("data/processed_dataset.csv", index=False)
df[output_cols].to_csv("data/processed.csv", index=False)
print("✅ Processed data saved → data/processed.csv")

# ── Save label maps for use in later steps ───────────────────
import json
with open("data/label_map.json", "w") as f:
    json.dump({"label2id": label2id, "id2label": id2label}, f, indent=2)
print("✅ Label map saved  → data/label_map.json")