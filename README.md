# Language-Extension
A google chrome extension to replace words with a selected language.

# Steps

1. Install dependences
   ``` npm install ```
2. Add your API key to `server/local-config.js`
3. Start the backend
   ``` npm run server ```
4. Build the Extension
   ``` npm run build ```
5. Load the extension in the browser
   - Open your browser and navigate to chrome://extensions/
   - Enable "Developer mode"
   - Click "Load unpacked" and select the "dist" folder from the project root
   - Extension should appear in the extensions list
6. Test the Extension
   - Visit https://en.wikipedia.org/wiki/Chess

# Development
- Run ```npm run build``` to update the dist folder
- Run ```npm run server``` to start the local translation backend
- Reload the extension in chrome://extensions/
