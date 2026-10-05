import api from '../../../shared/api/axiosInstance';

const createId = (prefix = 'item') => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const DEFAULT_AMENITIES = ['Charging Port', 'WiFi', 'Blanket', 'Water Bottle', 'Live Tracking'];
const createDefaultCancellationRules = () => [
  {
    id: createId('cancel'),
    label: '48h+ before departure',
    hoursBeforeDeparture: 48,
    refundType: 'percentage',
    refundValue: 90,
    notes: '10% cancellation charge',
  },
  {
    id: createId('cancel'),
    label: '24h to 48h before departure',
    hoursBeforeDeparture: 24,
    refundType: 'percentage',
    refundValue: 75,
    notes: '25% cancellation charge',
  },
  {
    id: createId('cancel'),
    label: '6h to 24h before departure',
    hoursBeforeDeparture: 6,
    refundType: 'percentage',
    refundValue: 50,
    notes: '50% cancellation charge',
  },
  {
    id: createId('cancel'),
    label: 'Within 6h of departure',
    hoursBeforeDeparture: 0,
    refundType: 'percentage',
    refundValue: 0,
    notes: 'No refund',
  },
];

const createSeatCell = (deckCode, rowNumber, seatCode, variant = 'seat') => ({
  kind: 'seat',
  id: `${deckCode}${rowNumber}${seatCode}`,
  label: `${rowNumber}${seatCode}`,
  variant,
  status: 'available',
});

const createEmptyCell = () => ({
  kind: 'aisle',
});

const createEmptyRoute = () => ({
  routeName: '',
  originCity: '',
  destinationCity: '',
  distanceKm: '',
  durationHours: '',
  stops: [],
});

const createLowerDeckSeater = (rows = 10, deckCode = 'L') =>
  Array.from({ length: rows }, (_, index) => {
    const rowNumber = index + 1;
    return [
      createSeatCell(deckCode, rowNumber, 'A', 'window'),
      createSeatCell(deckCode, rowNumber, 'B', 'aisle'),
      createEmptyCell(),
      createSeatCell(deckCode, rowNumber, 'C', 'aisle'),
      createSeatCell(deckCode, rowNumber, 'D', 'window'),
    ];
  });

const createSleeperDeck = (rows = 6, deckCode = 'L') =>
  Array.from({ length: rows }, (_, index) => {
    const rowNumber = index + 1;
    return [
      createSeatCell(deckCode, rowNumber, 'LB', 'sleeper'),
      createEmptyCell(),
      createSeatCell(deckCode, rowNumber, 'UB', 'sleeper'),
    ];
  });

const createMixedDeck = () => [
  ...createLowerDeckSeater(5, 'L'),
  [
    createSeatCell('L', 6, 'SL', 'sleeper'),
    createEmptyCell(),
    createSeatCell('L', 6, 'SR', 'sleeper'),
  ],
  [
    createSeatCell('L', 7, 'SL', 'sleeper'),
    createEmptyCell(),
    createSeatCell('L', 7, 'SR', 'sleeper'),
  ],
];

export const BUS_BLUEPRINT_TEMPLATES = [
  {
    key: 'seater_2_2',
    label: 'Seater 2+2',
    category: 'Seater Coach',
    lowerDeck: createLowerDeckSeater(11, 'L'),
    upperDeck: [],
  },
  {
    key: 'sleeper_2_1',
    label: 'Sleeper 2+1',
    category: 'Sleeper Coach',
    lowerDeck: createSleeperDeck(6, 'L'),
    upperDeck: createSleeperDeck(6, 'U'),
  },
  {
    key: 'mixed_redbus',
    label: 'Semi Sleeper Mix',
    category: 'Hybrid Coach',
    lowerDeck: createMixedDeck(),
    upperDeck: createSleeperDeck(4, 'U'),
  },
];

export const createBlueprintFromTemplate = (templateKey = 'seater_2_2') => {
  const template = BUS_BLUEPRINT_TEMPLATES.find((item) => item.key === templateKey) || BUS_BLUEPRINT_TEMPLATES[0];

  return {
    templateKey: template.key,
    lowerDeck: JSON.parse(JSON.stringify(template.lowerDeck)),
    upperDeck: JSON.parse(JSON.stringify(template.upperDeck)),
  };
};

export const countSeatsInDeck = (deckRows = []) =>
  deckRows.flat().filter((cell) => cell?.kind === 'seat').length;

export const countTotalSeats = (blueprint = {}) =>
  countSeatsInDeck(blueprint.lowerDeck || []) + countSeatsInDeck(blueprint.upperDeck || []);

export const createBusDraft = () => ({
  id: createId('bus'),
  ownerDriverId: '',
  operatorName: '',
  busName: '',
  serviceNumber: '',
  driverName: '',
  driverPhone: '',
  coachType: 'AC Sleeper',
  busCategory: 'Sleeper',
  registrationNumber: '',
  busColor: '#1f2937',
  seatPrice: '899',
  adminCommissionPercentage: '0',
  serviceTaxPercentage: '0',
  variantPricing: {
    seat: '899',
    window: '899',
    aisle: '899',
    sleeper: '1199',
  },
  fareCurrency: 'INR',
  boardingPolicy: 'Reach 15 minutes before departure.',
  cancellationPolicy: 'Cancellation allowed up to 6 hours before departure.',
  cancellationRules: createDefaultCancellationRules(),
  luggagePolicy: 'One cabin bag and one check-in bag per passenger.',
  amenities: [...DEFAULT_AMENITIES],
  image: '',
  coverImage: '',
  galleryImages: [],
  blueprint: createBlueprintFromTemplate('sleeper_2_1'),
  route: {
    routeName: '',
    originCity: '',
    destinationCity: '',
    distanceKm: '',
    durationHours: '',
    stops: [
      {
        id: createId('stop'),
        city: '',
        pointName: '',
        stopType: 'pickup',
        arrivalTime: '',
        departureTime: '',
      },
      {
        id: createId('stop'),
        city: '',
        pointName: '',
        stopType: 'drop',
        arrivalTime: '',
        departureTime: '',
      },
    ],
  },
  returnRouteEnabled: false,
  returnRoute: createEmptyRoute(),
  schedules: [
    {
      id: createId('schedule'),
      label: 'Daily Evening Service',
      departureTime: '21:00',
      arrivalTime: '06:15',
      activeDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      status: 'active',
    },
  ],
  status: 'draft',
  capacity: countTotalSeats(createBlueprintFromTemplate('sleeper_2_1')),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const normalizeBusCatalog = (catalog = []) =>
  catalog.map((bus) => {
    const fallbackDraft = createBusDraft();
    const blueprint = bus.blueprint || createBlueprintFromTemplate(bus.blueprint?.templateKey);

    return {
      ...fallbackDraft,
      ...bus,
      ownerDriverId: bus.ownerDriverId || '',
      blueprint,
      seatPrice:
        bus.seatPrice !== undefined && bus.seatPrice !== null ? String(bus.seatPrice) : fallbackDraft.seatPrice,
      adminCommissionPercentage:
        bus.adminCommissionPercentage !== undefined && bus.adminCommissionPercentage !== null
          ? String(bus.adminCommissionPercentage)
          : fallbackDraft.adminCommissionPercentage,
      serviceTaxPercentage:
        bus.serviceTaxPercentage !== undefined && bus.serviceTaxPercentage !== null
          ? String(bus.serviceTaxPercentage)
          : fallbackDraft.serviceTaxPercentage,
      variantPricing: {
        seat: String(bus.variantPricing?.seat ?? bus.seatPrice ?? fallbackDraft.variantPricing.seat),
        window: String(bus.variantPricing?.window ?? bus.seatPrice ?? fallbackDraft.variantPricing.window),
        aisle: String(bus.variantPricing?.aisle ?? bus.seatPrice ?? fallbackDraft.variantPricing.aisle),
        sleeper: String(bus.variantPricing?.sleeper ?? bus.seatPrice ?? fallbackDraft.variantPricing.sleeper),
      },
      route: {
        ...fallbackDraft.route,
        ...bus.route,
        stops:
          Array.isArray(bus.route?.stops) && bus.route.stops.length > 0
            ? bus.route.stops
            : fallbackDraft.route.stops,
      },
      returnRouteEnabled: Boolean(bus.returnRouteEnabled),
      returnRoute: {
        ...createEmptyRoute(),
        ...fallbackDraft.returnRoute,
        ...bus.returnRoute,
        stops:
          Array.isArray(bus.returnRoute?.stops) && bus.returnRoute.stops.length > 0
            ? bus.returnRoute.stops
            : [],
      },
      schedules:
        Array.isArray(bus.schedules) && bus.schedules.length > 0 ? bus.schedules : fallbackDraft.schedules,
      amenities:
        Array.isArray(bus.amenities) && bus.amenities.length > 0 ? bus.amenities : fallbackDraft.amenities,
      image: bus.image || bus.coverImage || '',
      coverImage: bus.coverImage || bus.image || '',
      galleryImages: Array.isArray(bus.galleryImages) ? bus.galleryImages.filter(Boolean) : [],
      cancellationRules:
        Array.isArray(bus.cancellationRules) && bus.cancellationRules.length > 0
          ? bus.cancellationRules
          : fallbackDraft.cancellationRules,
      capacity: bus.capacity || countTotalSeats(blueprint),
    };
  });

const getResultsArray = (response) => {
  if (Array.isArray(response?.data?.results)) {
    return response.data.results;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  return [];
};

export const getAdminBuses = async () => {
  const response = await api.get('/admin/bus-services');
  return normalizeBusCatalog(getResultsArray(response));
};

export const upsertAdminBus = async (payload) => {
  const requestPayload = {
    ...payload,
    registrationNumber: String(payload.registrationNumber || '').toUpperCase(),
    fareCurrency: String(payload.fareCurrency || 'INR').toUpperCase(),
    capacity: countTotalSeats(payload.blueprint || {}),
    adminCommissionPercentage: Math.min(100, Math.max(0, Number(payload.adminCommissionPercentage || 0))),
    serviceTaxPercentage: Math.min(100, Math.max(0, Number(payload.serviceTaxPercentage || 0))),
  };

  const response = payload.id?.startsWith('bus-')
    ? await api.post('/admin/bus-services', requestPayload)
    : await api.patch(`/admin/bus-services/${payload.id}`, requestPayload);

  return normalizeBusCatalog([response?.data || response])[0];
};

export const deleteAdminBus = async (busId) => {
  await api.delete(`/admin/bus-services/${busId}`);
  return true;
};
