// Vercel entry point: serves the Express app that `npm run build` compiles to dist/.
// Locally the app runs through src/server.ts instead.
import { createApp } from '../dist/app.js'

export default createApp()
