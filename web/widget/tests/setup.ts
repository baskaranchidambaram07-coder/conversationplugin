import { configure } from "@testing-library/react";

// Renderers load on demand (charts, diagrams, maths, highlighting), and under a full parallel run a chunk can take
// more than the default second to arrive; a wait only lasts this long when something is really missing.
configure({ asyncUtilTimeout: 5000 });
