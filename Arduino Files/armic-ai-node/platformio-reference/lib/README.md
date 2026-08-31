# Edge Impulse library slot

Place your exported Arduino library here, e.g.:

```
lib/Armic_inferencing/
```

Export from [Edge Impulse Studio](https://studio.edgeimpulse.com) → **Deploy** → **Arduino library** → download ZIP → extract into `lib/`.

**Do not commit** proprietary model weights if your project policy forbids it — each builder exports their own copy locally.

Expected classes (ARMIC rehab demo):

| EI label | MQTT `exercise` |
|----------|-------------------|
| Baseline | `none` |
| Bicepcurl | `bicep` |
| Lateralraise | `lateral` |
| Elbowflexion | `elbowflex` |

Sample rate **50 Hz**, window **2000 ms**, 6-axis fusion (acc + gyro).
