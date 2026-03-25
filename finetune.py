# ============================================================
# STEP 4 — BERT Fine-Tuning (Best Accuracy)
# Run: python step4_bert_model.py
# Requires: pip install transformers datasets torch accelerate
# NOTE: Uses 'bert-base-uncased' — swap for 'ai4bharat/indic-bert'
#       if your complaints include Hindi/regional languages
# ============================================================
import os
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
import pandas as pd
import json
import numpy as np
import torch
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

from transformers import (AutoTokenizer,
                          AutoModelForSequenceClassification,
                          TrainingArguments, Trainer,
                          DataCollatorWithPadding,
                          EarlyStoppingCallback)
from datasets import Dataset

# ── Config ───────────────────────────────────────────────────
MODEL_NAME  = "bert-base-uncased"   # change to "ai4bharat/indic-bert" for Hindi
MAX_LEN     = 128
BATCH_SIZE  = 8
EPOCHS      = 5
LR          = 2e-5

# ── Load data ────────────────────────────────────────────────
df = pd.read_csv("data/processed.csv")
with open("data/label_map.json") as f:
    maps = json.load(f)
label2id = maps['label2id']
id2label = {int(k): v for k, v in maps['id2label'].items()}
NUM_LABELS = len(label2id)

# ── Split ────────────────────────────────────────────────────
train_df, test_df = train_test_split(
    df[['clean_text','label']], test_size=0.2,
    random_state=42, stratify=df['label']
)
# Further split train → train + validation
train_df, val_df = train_test_split(
    train_df, test_size=0.15, random_state=42, stratify=train_df['label']
)
print(f"Train: {len(train_df)} | Val: {len(val_df)} | Test: {len(test_df)}")

# ── Tokenizer ────────────────────────────────────────────────
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

def tokenize_fn(batch):
    return tokenizer(
        batch['clean_text'],
        truncation = True,
        max_length = MAX_LEN,
        padding    = False      # DataCollatorWithPadding pads dynamically per batch
    )

# ── HuggingFace Dataset objects ──────────────────────────────
def make_hf_dataset(dataframe):
    ds = Dataset.from_pandas(
        dataframe.rename(columns={'label': 'labels'}).reset_index(drop=True)
    )
    return ds.map(tokenize_fn, batched=True, remove_columns=['clean_text'])

train_ds = make_hf_dataset(train_df)
val_ds   = make_hf_dataset(val_df)
test_ds  = make_hf_dataset(test_df)

# ── Model ────────────────────────────────────────────────────
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels = NUM_LABELS,
    id2label   = id2label,
    label2id   = label2id
)

# ── Metrics ──────────────────────────────────────────────────
def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    from sklearn.metrics import f1_score
    return {
        "accuracy": accuracy_score(labels, preds),
        "f1"      : f1_score(labels, preds, average='weighted')
    }

# ── Training arguments ───────────────────────────────────────
training_args = TrainingArguments(
    output_dir                  = "models/bert_checkpoints",
    num_train_epochs            = EPOCHS,
    per_device_train_batch_size = BATCH_SIZE,
    per_device_eval_batch_size  = BATCH_SIZE * 2,
    learning_rate               = LR,
    weight_decay                = 0.01,
    eval_strategy               = "epoch",
    save_strategy               = "epoch",
    load_best_model_at_end      = True,
    metric_for_best_model       = "f1",
    logging_steps               = 10,
    report_to                   = "none",
    fp16                        = torch.cuda.is_available(),
)

# ── Trainer ──────────────────────────────────────────────────
# NEW (works with transformers >= 4.46)
trainer = Trainer(
    model            = model,
    args             = training_args,
    train_dataset    = train_ds,
    eval_dataset     = val_ds,
    processing_class = tokenizer,       # ← renamed
    data_collator    = DataCollatorWithPadding(tokenizer),
    compute_metrics  = compute_metrics,
    callbacks        = [EarlyStoppingCallback(early_stopping_patience=2)]
)

print("\n" + "=" * 55)
print(f"FINE-TUNING {MODEL_NAME} for {EPOCHS} epochs")
print("=" * 55)
trainer.train()

# ── Evaluate on test set ─────────────────────────────────────
print("\nEvaluating on test set...")
preds_output = trainer.predict(test_ds)
y_pred = np.argmax(preds_output.predictions, axis=-1)
y_true = test_df['label'].values
target_names = [id2label[i] for i in sorted(id2label)]

print("\n" + "=" * 55)
print("BERT TEST RESULTS")
print("=" * 55)
print(f"Accuracy : {accuracy_score(y_true, y_pred):.4f}")
print()
print(classification_report(y_true, y_pred, target_names=target_names))

# ── Save model + tokenizer ───────────────────────────────────
trainer.save_model("models/bert_finetuned")
tokenizer.save_pretrained("models/bert_finetuned")
print("✅ BERT model saved → models/bert_finetuned/")