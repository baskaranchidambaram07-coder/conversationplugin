## Sales by region

Here is a quick bar chart of last quarter's sales, with the numbers written into the code:

```python
import matplotlib.pyplot as plt

regions = ["North", "South", "East", "West", "Central"]
sales = [48_200, 39_500, 52_800, 31_900, 44_600]  # in pounds

plt.figure(figsize=(8, 5))
plt.bar(regions, sales, color="#4C72B0")
plt.title("Sales by region, Q3")
plt.xlabel("Region")
plt.ylabel("Sales (£)")
plt.show()
```

## Visitors by channel

And the same months for each channel, plotted with Plotly from a dictionary:

```python
import pandas as pd
import plotly.express as px

data = {
    "Month": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    "Web": [1200, 1350, 1500, 1420, 1610, 1780],
    "Mobile": [800, 940, 1100, 1260, 1390, 1530],
}
df = pd.DataFrame(data)

fig = px.line(df, x="Month", y=["Web", "Mobile"], title="Visitors by channel")
fig.show()
```

## Computed values stay code

Values the code computes cannot be drawn without running it, so this one is shown as code only:

```python
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 10, 100)
plt.plot(x, np.sin(x))
plt.show()
```
