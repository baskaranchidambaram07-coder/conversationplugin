## Library visits

Visits rose through the autumn term:

```chart
{
  "type": "bar",
  "title": "Library visits by month",
  "x": "month",
  "y": ["day", "evening"],
  "labels": { "month": "Month", "day": "Day", "evening": "Evening" },
  "data": [
    { "month": "Sep", "day": 1240, "evening": 610 },
    { "month": "Oct", "day": 1580, "evening": 820 },
    { "month": "Nov", "day": 1710, "evening": 905 },
    { "month": "Dec", "day": 960, "evening": 380 },
    { "month": "Jan", "day": 1350, "evening": 700 },
    { "month": "Feb", "day": 1490, "evening": 760 }
  ]
}
```

## Heating, by house

```chart
{
  "type": "line",
  "title": "Average room temperature (°C)",
  "x": "week",
  "labels": { "week": "Week", "house_1": "House 1", "house_2": "House 2" },
  "data": [
    { "week": "W1", "house_1": 19.5, "house_2": 20.1 },
    { "week": "W2", "house_1": 19.8, "house_2": 20.4 },
    { "week": "W3", "house_1": 18.9, "house_2": null },
    { "week": "W4", "house_1": 19.2, "house_2": 19.7 },
    { "week": "W5", "house_1": 20.3, "house_2": 20.9 },
    { "week": "W6", "house_1": 20.8, "house_2": 21.2 },
    { "week": "W7", "house_1": 20.1, "house_2": 20.6 },
    { "week": "W8", "house_1": 19.7, "house_2": 20.2 }
  ]
}
```

## Guest room bookings

```chart
{
  "type": "area",
  "title": "Guest room nights booked",
  "x": "month",
  "y": "nights",
  "data": [
    { "month": "Sep", "nights": 42 },
    { "month": "Oct", "nights": 58 },
    { "month": "Nov", "nights": 51 },
    { "month": "Dec", "nights": 77 },
    { "month": "Jan", "nights": 39 },
    { "month": "Feb", "nights": 46 }
  ]
}
```

## Where residents come from

```chart
{
  "type": "pie",
  "title": "Residents by region",
  "x": "region",
  "y": "residents",
  "data": [
    { "region": "Europe", "residents": 182 },
    { "region": "East Asia", "residents": 164 },
    { "region": "South Asia", "residents": 121 },
    { "region": "North America", "residents": 88 },
    { "region": "Africa", "residents": 64 },
    { "region": "Latin America", "residents": 41 },
    { "region": "Middle East", "residents": 37 },
    { "region": "Oceania", "residents": 12 },
    { "region": "Caribbean", "residents": 6 }
  ]
}
```

## Study hours and marks

```chart
{
  "type": "scatter",
  "title": "Weekly study hours against coursework mark",
  "x": "hours",
  "y": ["masters", "doctoral"],
  "labels": { "hours": "Study hours", "masters": "Master's", "doctoral": "Doctoral" },
  "data": [
    { "hours": 12, "masters": 58, "doctoral": null },
    { "hours": 18, "masters": 64, "doctoral": 61 },
    { "hours": 22, "masters": 66, "doctoral": 68 },
    { "hours": 27, "masters": 71, "doctoral": 70 },
    { "hours": 31, "masters": 69, "doctoral": 75 },
    { "hours": 36, "masters": 77, "doctoral": 79 },
    { "hours": 40, "masters": null, "doctoral": 82 }
  ]
}
```

A chart that does not hold together is shown as its code:

```chart
{ "type": "bar", "x": "month", "data": "not a list" }
```
