import React, { useEffect, useState } from "react"
import { motion } from "framer-motion"

export default function Loader() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Simulate loading progress bar
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev
        return prev + 10
      })
    }, 150)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gray-50/80 dark:bg-zinc-950/80 backdrop-blur-md transition-colors duration-200">
      {/* Sleek top progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-gray-100 dark:bg-zinc-800">
        <motion.div 
          className="h-full bg-gradient-to-r from-[#EB590E] to-[#F38F24] shadow-[0_0_8px_#EB590E]"
          initial={{ width: "0%" }}
          animate={{ width: `${progress}%` }}
          transition={{ ease: "easeOut", duration: 0.2 }}
        />
      </div>

      {/* Modern pulsing central spinner */}
      <div className="relative flex items-center justify-center">
        {/* Outer glowing pulsing ring */}
        <motion.div 
          className="absolute w-20 h-20 rounded-full border border-[#EB590E]/20"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.8, 0.3] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
        />
        
        {/* Inner spinning ring */}
        <motion.div 
          className="w-12 h-12 rounded-full border-[3px] border-[#EB590E] border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        />
        
        {/* Pulse-scaled brand mark inside the ring */}
        <motion.div 
          className="absolute text-[10px] font-black text-[#EB590E] tracking-wider uppercase"
          animate={{ scale: [0.95, 1.05, 0.95] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
        >
          QD
        </motion.div>
      </div>
      
      {/* Soft loading text with skeleton dots */}
      <div className="mt-6 flex flex-col items-center gap-1.5">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 tracking-wide">
          Securing your request...
        </p>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-[#EB590E]"
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
