import React from "react";

const ModeSelector = ({ mode, onChange }) => (
  <div className="flex gap-3">
    <button
      onClick={() => onChange("single")}
      className={`flex-1 p-4 rounded-xl border-2 transition-all ${mode === "single"
        ? "border-primary-600 bg-primary-50 text-primary-700 shadow-sm"
        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
        }`}
    >
      <div className="font-bold text-base mb-1">Single Service</div>
      <div className="text-sm text-gray-600">Show one category on the home screen</div>
    </button>
    <button
      onClick={() => onChange("multi")}
      className={`flex-1 p-4 rounded-xl border-2 transition-all ${mode === "multi"
        ? "border-primary-600 bg-primary-50 text-primary-700 shadow-sm"
        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
        }`}
    >
      <div className="font-bold text-base mb-1">Multi Service</div>
      <div className="text-sm text-gray-600">Show multiple categories on the home screen</div>
    </button>
  </div>
);

export default ModeSelector;


