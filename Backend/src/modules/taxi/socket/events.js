export const SOCKET_EVENTS = Object.freeze({
  ERROR: 'errorMessage',
  RIDE_JOIN: 'ride:join',
  RIDE_REJOIN_CURRENT: 'ride:rejoin-current',
  RIDE_JOINED: 'ride:joined',
  RIDE_STATE: 'ride:state',
  RIDE_STATUS_UPDATE: 'ride:status:update',
  RIDE_STATUS_UPDATED: 'ride:status:updated',
  RIDE_DRIVER_LOCATION_UPDATE: 'ride:driver-location:update',
  RIDE_DRIVER_LOCATION_UPDATED: 'ride:driver-location:updated',
  RIDE_DRIVER_ROUTE_UPDATED: 'ride:driver-route:updated',
  RIDE_MESSAGE_SEND: 'ride:message:send',
  RIDE_MESSAGE_NEW: 'ride:message:new',
  // Multiple stops (plan §4.1): the driver emits the first, the ride room hears the second.
  RIDE_STOP_REACHED: 'ride:stop:reached',
  RIDE_STOP_UPDATED: 'ride:stop:updated',
  // Tolls added or reviewed (plan §4.3).
  RIDE_TOLLS_UPDATED: 'ride:tolls:updated',
  // Live ETA to the pickup or the drop (plan §4.6).
  RIDE_ETA_UPDATED: 'ride:eta:updated',
});
