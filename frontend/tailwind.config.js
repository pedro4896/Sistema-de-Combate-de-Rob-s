/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: "#001224",
          card: "#061b35",
          accent: "#00FF9C",
          danger: "#FF4C4C",
          metal: "#C0C0C0"
        }
      }
    }
  },
  plugins: []
};
