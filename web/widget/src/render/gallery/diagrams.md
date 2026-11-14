## Solution design: WhatsApp sign-in

Paste the XML into draw.io with **Extras → Edit Diagram**.

```xml
<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />

    <!-- User -->
    <mxCell id="user" value="User (Mobile/Web App)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="40" y="80" width="160" height="60" as="geometry" />
    </mxCell>

    <!-- App Frontend -->
    <mxCell id="app" value="App Frontend&#10;(Login Screen)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
      <mxGeometry x="280" y="80" width="160" height="60" as="geometry" />
    </mxCell>

    <!-- Backend Server -->
    <mxCell id="backend" value="Backend Server&#10;(Auth Service)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1">
      <mxGeometry x="520" y="80" width="160" height="60" as="geometry" />
    </mxCell>

    <!-- WhatsApp API -->
    <mxCell id="whatsapp" value="WhatsApp Business API&#10;(Meta/Twilio)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
      <mxGeometry x="760" y="80" width="180" height="60" as="geometry" />
    </mxCell>

    <!-- Database -->
    <mxCell id="db" value="Database&#10;(User/OTP Store)" style="shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;boundedLbl=1;" vertex="1" parent="1">
      <mxGeometry x="560" y="260" width="100" height="80" as="geometry" />
    </mxCell>

    <!-- Session/JWT -->
    <mxCell id="token" value="Session/JWT&#10;Token Generator" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
      <mxGeometry x="520" y="400" width="160" height="60" as="geometry" />
    </mxCell>

    <mxCell id="e1" value="1. Enter Phone No." style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="user" target="app">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e2" value="2. Send Phone No." style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="app" target="backend">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e3" value="3. Generate OTP &amp; Call API" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="backend" target="whatsapp">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e4" value="4. Deliver OTP Message" style="edgeStyle=orthogonalEdgeStyle;html=1;entryX=1;entryY=0.5;" edge="1" parent="1" source="whatsapp" target="user">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="850" y="40" />
          <mxPoint x="120" y="40" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="e5" value="5. Store OTP" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="backend" target="db">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e9" value="9. Generate Token" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="backend" target="token">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e10" value="10. Return Token" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="token" target="app">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="360" y="430" />
        </Array>
      </mxGeometry>
    </mxCell>
  </root>
</mxGraphModel>
```

### The same idea, sketched in Excalidraw

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    { "id": "visitor", "type": "ellipse", "x": 0, "y": 0, "width": 140, "height": 70, "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff", "strokeStyle": "solid", "strokeWidth": 2 },
    { "id": "visitor-text", "type": "text", "x": 30, "y": 22, "width": 80, "height": 25, "text": "Visitor", "fontSize": 20, "textAlign": "center", "containerId": "visitor", "strokeColor": "#1e1e1e" },
    { "id": "gateway", "type": "rectangle", "x": 260, "y": 0, "width": 160, "height": 70, "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "roundness": { "type": 3 }, "strokeWidth": 2 },
    { "id": "gateway-text", "type": "text", "x": 290, "y": 22, "width": 100, "height": 25, "text": "Gateway", "fontSize": 20, "textAlign": "center", "containerId": "gateway", "strokeColor": "#1e1e1e" },
    { "id": "agent", "type": "diamond", "x": 540, "y": -15, "width": 140, "height": 100, "strokeColor": "#1e1e1e", "backgroundColor": "#ffec99", "strokeWidth": 2 },
    { "id": "agent-text", "type": "text", "x": 580, "y": 22, "width": 60, "height": 25, "text": "Agent", "fontSize": 20, "textAlign": "center", "containerId": "agent", "strokeColor": "#1e1e1e" },
    { "id": "ask", "type": "arrow", "x": 140, "y": 35, "width": 120, "height": 0, "points": [[0, 0], [120, 0]], "strokeColor": "#1e1e1e", "strokeWidth": 2, "endArrowhead": "arrow", "startBinding": { "elementId": "visitor" }, "endBinding": { "elementId": "gateway" } },
    { "id": "ask-text", "type": "text", "x": 175, "y": 10, "width": 50, "height": 20, "text": "asks", "fontSize": 16, "containerId": "ask", "strokeColor": "#1e1e1e" },
    { "id": "relay", "type": "arrow", "x": 420, "y": 35, "width": 120, "height": 0, "points": [[0, 0], [120, 0]], "strokeColor": "#1e1e1e", "strokeWidth": 2, "strokeStyle": "dashed", "endArrowhead": "arrow", "startBinding": { "elementId": "gateway" }, "endBinding": { "elementId": "agent" } },
    { "id": "gone", "type": "rectangle", "x": 0, "y": 200, "width": 50, "height": 50, "isDeleted": true }
  ]
}
```
