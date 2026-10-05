import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  // Current ride (requested / ongoing)
  currentRide: {
    id: null,
    status: null, // 'searching' | 'accepted' | 'ongoing' | 'completed' | 'cancelled'
    pickup: null,
    drop: null,
    driver: null,
    fare: null,
  },
  // User's saved locations (home, work, etc.)
  savedLocations: [],
}

const taxiSlice = createSlice({
  name: 'taxi',
  initialState,
  reducers: {
    // —— Current ride ——
    setCurrentRide(state, action) {
      state.currentRide = { ...initialState.currentRide, ...action.payload }
    },
    clearCurrentRide(state) {
      state.currentRide = { ...initialState.currentRide }
    },
    updateRideStatus(state, action) {
      state.currentRide.status = action.payload ?? state.currentRide.status
    },

    // —— Saved locations ——
    setSavedLocations(state, action) {
      state.savedLocations = Array.isArray(action.payload) ? action.payload : []
    },
    addSavedLocation(state, action) {
      const loc = action.payload
      if (loc && (loc.id || loc.label)) {
        state.savedLocations.push(loc)
      }
    },
    removeSavedLocation(state, action) {
      const id = action.payload
      state.savedLocations = state.savedLocations.filter(
        (l) => l.id !== id && l.label !== id
      )
    },

    // Reset taxi slice (e.g. on logout)
    resetTaxi(state) {
      state.currentRide = { ...initialState.currentRide }
      state.savedLocations = []
    },
  },
})

export const {
  setCurrentRide,
  clearCurrentRide,
  updateRideStatus,
  setSavedLocations,
  addSavedLocation,
  removeSavedLocation,
  resetTaxi,
} = taxiSlice.actions
export default taxiSlice.reducer
