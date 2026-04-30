@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  
  --color-app-bg: #1b1b1e;
  --color-app-accent-1: #faa916;
  --color-app-accent-2: #6d676e;
  --color-app-accent-3: #96031a;
  --color-app-text: #fbfffe;
}

@layer base {
  .custom-scrollbar {
    scroll-behavior: smooth;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 12px;
    height: 12px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    margin: 4px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(250, 169, 22, 0.6);
    border-radius: 10px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(250, 169, 22, 1);
    background-clip: content-box;
  }
}
