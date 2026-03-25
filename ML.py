# ============================================================
# STEP 3 — TF-IDF + Classical ML (Baseline)
# Run: python step3_tfidf_model.py
# ============================================================

import pandas as pd
import json
import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection    import train_test_split, cross_val_score
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model       import LogisticRegression
from sklearn.svm                import LinearSVC
from sklearn.naive_bayes        import MultinomialNB
from sklearn.metrics            import (classification_report,
                                        confusion_matrix,
                                        accuracy_score)
from sklearn.pipeline           import Pipeline

# ── Load data ────────────────────────────────────────────────
df = pd.read_csv("data/processed.csv")
with open("data/label_map.json") as f:
    maps = json.load(f)
label2id = maps['label2id']
id2label = {int(k): v for k, v in maps['id2label'].items()}

X = df['clean_text']
y = df['label']

# ── Train / test split ───────────────────────────────────────
# stratify=y ensures each class appears proportionally in both sets
X_train, X_test, y_train, y_test = train_test_split(
    X, y,
    test_size   = 0.2,   # 80% train, 20% test
    random_state= 42,
    stratify    = y
)
print(f"Train size : {len(X_train)} | Test size : {len(X_test)}")

# ── TF-IDF vectorizer ────────────────────────────────────────
# max_features: top N most frequent terms
# ngram_range : include single words AND two-word phrases
tfidf = TfidfVectorizer(
    max_features = 5000,
    ngram_range  = (1, 2),
    sublinear_tf = True    # apply log(tf) to reduce impact of very frequent words
)

# ── Compare 3 classifiers ────────────────────────────────────
classifiers = {
    "Logistic Regression": LogisticRegression(max_iter=1000, C=5, class_weight='balanced'),
    "Linear SVM"         : LinearSVC(max_iter=2000, C=1.0, class_weight='balanced'),
    "Naive Bayes"        : MultinomialNB(alpha=0.5)
}

print("\n" + "=" * 55)
print("COMPARING CLASSIFIERS (5-fold cross-validation)")
print("=" * 55)

best_name  = None
best_score = 0.0

for name, clf in classifiers.items():
    pipe = Pipeline([('tfidf', tfidf), ('clf', clf)])
    scores = cross_val_score(pipe, X_train, y_train, cv=5, scoring='f1_weighted')
    mean_f1 = scores.mean()
    print(f"  {name:25s} → CV F1 = {mean_f1:.4f} (±{scores.std():.4f})")
    if mean_f1 > best_score:
        best_score = mean_f1
        best_name  = name

print(f"\n  🏆 Best: {best_name} (F1 = {best_score:.4f})")

# ── Train best model on full training set ────────────────────
best_clf  = classifiers[best_name]
best_pipe = Pipeline([('tfidf', tfidf), ('clf', best_clf)])
best_pipe.fit(X_train, y_train)

# ── Evaluate on test set ─────────────────────────────────────
y_pred    = best_pipe.predict(X_test)
accuracy  = accuracy_score(y_test, y_pred)

print("\n" + "=" * 55)
print("TEST SET RESULTS —", best_name)
print("=" * 55)
print(f"Accuracy : {accuracy:.4f}")
print()
target_names = [id2label[i] for i in sorted(id2label)]
print(classification_report(y_test, y_pred, target_names=target_names))

# ── Confusion matrix ─────────────────────────────────────────
cm = confusion_matrix(y_test, y_pred)
fig, ax = plt.subplots(figsize=(9, 7))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=target_names, yticklabels=target_names, ax=ax)
ax.set_xlabel('Predicted', fontsize=11)
ax.set_ylabel('Actual',    fontsize=11)
ax.set_title(f'Confusion Matrix — {best_name}', fontsize=13, fontweight='bold', pad=12)
plt.xticks(rotation=30, ha='right')
plt.yticks(rotation=0)
plt.tight_layout()
plt.savefig("outputs/confusion_matrix_tfidf.png", dpi=150, bbox_inches='tight')
print("✅ Confusion matrix saved → outputs/confusion_matrix_tfidf.png")

# ── Save best pipeline ───────────────────────────────────────
import os
import joblib

# Ensure 'models' folder exists
os.makedirs("models", exist_ok=True)

joblib.dump(best_pipe, "models/tfidf_pipeline.pkl")
joblib.dump(best_pipe, "models/tfidf_pipeline.pkl")
print("✅ Model saved        → models/tfidf_pipeline.pkl")

# ── Top TF-IDF features per class ───────────────────────────
print("\nTOP 8 FEATURES PER CATEGORY (Logistic Regression only)")
print("-" * 55)
if best_name == "Logistic Regression":
    feature_names = best_pipe.named_steps['tfidf'].get_feature_names_out()
    coef          = best_pipe.named_steps['clf'].coef_
    for i, cat in id2label.items():
        top_idx = coef[i].argsort()[-8:][::-1]
        top_words = [feature_names[j] for j in top_idx]
        print(f"  {cat:25s}: {', '.join(top_words)}")