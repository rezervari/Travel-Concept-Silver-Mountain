import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    // Citește fișierul local index.html
    const htmlContent = fs.readFileSync('index.html', 'utf8');

    console.log("Se trimite codul către Gemini pentru analiză...\n");

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `Analizează fișierul HTML următor și oferă-mi sugestii de optimizare sau erori existente:\n\n${htmlContent}`,
    });

    console.log("--- RĂSPUNS GEMINI ---");
    console.log(response.text);
  } catch (error) {
    console.error("Eroare:", error.message);
  }
}

run();