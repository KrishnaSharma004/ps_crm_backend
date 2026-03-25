# ============================================================
# STEP 1 — Exploratory Data Analysis (EDA)
# Run: python step1_eda.py
# ============================================================

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # non-interactive backend for VS Code

# ── Load dataset ────────────────────────────────────────────
df = pd.read_excel(r"C:\Users\samik\OneDrive\Desktop\hackathon\government_complaints_dataset.xlsx")

print("=" * 55)
print("DATASET OVERVIEW")
print("=" * 55)
print(f"Total complaints : {len(df)}")
print(f"Columns          : {df.columns.tolist()}")
print(f"Missing values   : {df.isnull().sum().sum()}")
print()

# ── Category distribution ────────────────────────────────────
print("CATEGORY DISTRIBUTION")
print("-" * 35)
cat_counts = df['Category'].value_counts()
print(cat_counts.to_string())
print()

# ── Subcategory distribution ─────────────────────────────────
print("SUBCATEGORY DISTRIBUTION")
print("-" * 35)
print(df['Subcategory'].value_counts().to_string())
print()

# ── Text length stats ────────────────────────────────────────
df['word_count'] = df['Complaint Text'].str.split().str.len()
print("TEXT LENGTH STATS (words)")
print("-" * 35)
print(df.groupby('Category')['word_count'].describe()[['mean','min','max']].round(1).to_string())
print()

# ── Plot 1: Category bar chart ───────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

colors = ['#4C72B0','#55A868','#C44E52','#8172B2','#CCB974','#64B5CD','#E07B39']
cat_counts.plot(kind='bar', ax=axes[0], color=colors, edgecolor='white', linewidth=0.5)
axes[0].set_title('Complaints by Category', fontsize=13, fontweight='bold', pad=12)
axes[0].set_xlabel('')
axes[0].set_ylabel('Count')
axes[0].tick_params(axis='x', rotation=30)
for bar, count in zip(axes[0].patches, cat_counts.values):
    axes[0].text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3,
                 str(count), ha='center', va='bottom', fontsize=10, fontweight='bold')

# ── Plot 2: Word count distribution ─────────────────────────
df.groupby('Category')['word_count'].mean().sort_values().plot(
    kind='barh', ax=axes[1], color='#4C72B0', edgecolor='white')
axes[1].set_title('Avg Word Count per Category', fontsize=13, fontweight='bold', pad=12)
axes[1].set_xlabel('Average words')
axes[1].set_ylabel('')

plt.suptitle('Government Complaints Dataset — EDA', fontsize=14, fontweight='bold', y=1.01)
plt.tight_layout()
import os

# Ensure outputs folder exists
os.makedirs("outputs", exist_ok=True)

plt.savefig("outputs/eda_overview.png", dpi=150, bbox_inches='tight')
plt.savefig("outputs/eda_overview.png", dpi=150, bbox_inches='tight')
print("✅ EDA chart saved → outputs/eda_overview.png")
print()

# ── Sample complaints ────────────────────────────────────────
print("SAMPLE COMPLAINTS PER CATEGORY")
print("-" * 55)
for cat in df['Category'].unique():
    sample = df[df['Category'] == cat]['Complaint Text'].iloc[0]
    print(f"\n[{cat}]\n  {sample}")