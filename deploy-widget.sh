#!/bin/bash
# Build three-body project and generate Übersicht widget
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIDGET_DIR="$SCRIPT_DIR/three-body.widget"

echo "Building..."
cd "$SCRIPT_DIR"
npx vite build 2>&1 | tail -3

echo "Generating widget..."
mkdir -p "$WIDGET_DIR/lib"
cp dist/index.html "$WIDGET_DIR/lib/index.html"

# Create widget entry if missing
if [ ! -f "$WIDGET_DIR/index.jsx" ]; then
cat > "$WIDGET_DIR/index.jsx" << 'JSX'
import { run } from 'uebersicht';
export const command = undefined;
export const refreshFrequency = false;
export const className = `
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100%; height: 100%;
  margin: 0; padding: 0; overflow: hidden;
`;
export const init = (dispatch) => {
  const dir = '/Users/html/Library/Application Support/Übersicht/widgets/three-body.widget';
  run(`cat "${dir}/lib/index.html"`).then((output) => dispatch({ type: 'LOADED', content: output }));
};
export const updateState = (event, prev) => event.type === 'LOADED' ? { ready: true, content: event.content } : prev;
export const initialState = { ready: false, content: '' };
export const render = ({ ready, content }) => {
  if (!ready) return <div style={{ color: '#fff' }}>Loading...</div>;
  return <iframe srcDoc={content} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'all' }} />;
};
JSX
  echo "Created index.jsx"
fi

SIZE=$(du -sh "$WIDGET_DIR/lib/index.html" | cut -f1)
echo "Done! Widget generated at: $WIDGET_DIR ($SIZE)"
echo "Copy to: ~/Library/Application Support/Übersicht/widgets/"
