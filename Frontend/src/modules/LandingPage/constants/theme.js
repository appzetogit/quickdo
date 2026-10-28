export const LANDING_THEME = {
  // Orange and Red Shade combination for Food Delivery, Courier, Hourly Rentals
  orange: {
    primary: '#ff5100', // Vibrant orange
    accent: '#e11d48',  // Rose red
    bg: 'rgba(255, 81, 0, 0.08)',
    border: 'rgba(225, 29, 72, 0.4)',
    shadow: 'rgba(255, 81, 0, 0.25)',
    gradient: 'linear-gradient(90deg, #ff5100, #e11d48)',
    bgGradient: 'from-[#ff5100] to-[#e11d48]',
  },
  
  // Dark Blue and Green combination for Ride Hailing, Airport Transfers, Cargo & Logistics
  blue: {
    primary: '#1d4ed8', // Dark blue
    accent: '#10b981',  // Emerald green
    bg: 'rgba(29, 78, 216, 0.08)',
    border: 'rgba(16, 185, 129, 0.4)',
    shadow: 'rgba(29, 78, 216, 0.25)',
    gradient: 'linear-gradient(90deg, #1d4ed8, #10b981)',
    bgGradient: 'from-[#1d4ed8] to-[#10b981]',
  },

  // Multicolor Gradient Highlights
  multicolor: {
    textGradient: 'bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]',
    buttonGradient: 'bg-gradient-to-r from-[#ff5100] via-[#e11d48] via-[#1d4ed8] to-[#10b981]',
    textGradientStyle: 'linear-gradient(90deg, #ff5100, #e11d48, #1d4ed8, #10b981)',
  }
};
