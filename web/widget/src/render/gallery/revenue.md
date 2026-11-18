# Synthetic Revenue Data Generator

Here's a complete synthetic dataset showing monthly revenue over 2 years with realistic patterns (growth trend + seasonality + random noise), along with code to visualize it.

## 📊 Sample Synthetic Revenue Data (Monthly, 2023-2024)

| Month    | Year | Revenue ($) |
|----------|------|-------------|
| Jan      | 2023 | 45,200      |
| Feb      | 2023 | 42,800      |
| Mar      | 2023 | 48,500      |
| Apr      | 2023 | 51,200      |
| May      | 2023 | 53,900      |
| Jun      | 2023 | 58,400      |
| Jul      | 2023 | 61,200      |
| Aug      | 2023 | 59,800      |
| Sep      | 2023 | 62,500      |
| Oct      | 2023 | 65,300      |
| Nov      | 2023 | 71,200      |
| Dec      | 2023 | 78,900      |
| Jan      | 2024 | 68,400      |
| Feb      | 2024 | 65,100      |
| Mar      | 2024 | 72,300      |
| Apr      | 2024 | 75,800      |
| May      | 2024 | 79,200      |
| Jun      | 2024 | 84,600      |
| Jul      | 2024 | 88,100      |
| Aug      | 2024 | 86,300      |
| Sep      | 2024 | 91,700      |
| Oct      | 2024 | 95,400      |
| Nov      | 2024 | 102,800     |
| Dec      | 2024 | 112,500     |

---

## 🐍 Python Code to Generate & Plot This Data

```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Set seed for reproducibility
np.random.seed(42)

# Generate date range
dates = pd.date_range(start="2023-01-01", end="2024-12-01", freq="MS")

# Base parameters
n = len(dates)
base_revenue = 45000
growth_rate = 0.025       # ~2.5% month-over-month growth
seasonal_amplitude = 8000 # seasonal swing

# Create synthetic revenue with trend + seasonality + noise
trend = base_revenue * (1 + growth_rate) ** np.arange(n)
seasonality = seasonal_amplitude * np.sin(2 * np.pi * np.arange(n) / 12 + 1)
noise = np.random.normal(0, 2000, n)

revenue = trend + seasonality + noise
revenue = np.round(revenue, -2)  # round to nearest 100

# Build DataFrame
df = pd.DataFrame({"Date": dates, "Revenue": revenue})

# --- Plot ---
plt.figure(figsize=(12, 6))
plt.plot(df["Date"], df["Revenue"], marker='o', linewidth=2, color="#2E86AB")
plt.fill_between(df["Date"], df["Revenue"], alpha=0.1, color="#2E86AB")

plt.title("Synthetic Monthly Revenue (2023-2024)", fontsize=16, fontweight='bold')
plt.xlabel("Month", fontsize=12)
plt.ylabel("Revenue ($)", fontsize=12)
plt.xticks(rotation=45)
plt.grid(alpha=0.3)
plt.tight_layout()
plt.show()

print(df)
```

---

## 🔧 Variations You Can Try

1. **Bar Chart** — replace `plt.plot()` with `plt.bar()` for a column chart comparison.
2. **Multiple Product Lines** — add columns like `Product_A`, `Product_B`, `Product_C` with different growth rates and stack them.
3. **Quarterly/Yearly Aggregation** — use `df.resample('Q')` or `df.resample('Y')` on the Date index.
4. **Add Forecast** — use `numpy.polyfit` or a simple linear regression to project 2025 revenue.
5. **Interactive Chart** — swap `matplotlib` for `plotly.express.line(df, x="Date", y="Revenue")` for an interactive, hoverable graph.

---

Would you like me to:
- Generate data for **multiple business segments/regions**?
- Create a **CSV file** you can download/import directly?
- Build a version with **declining or volatile revenue** (e.g., for a struggling business scenario)?
- Provide the **Plotly/Excel-ready** version for interactive dashboards?

Let me know your specific use case (e.g., SaaS MRR, retail sales, quarterly earnings) and I can tailor the synthetic data accordingly!
