import { useSearchParams, Link, useNavigate } from "react-router-dom";
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Clock,
  MapPin,
  Heart,
  Search,
  Tag,
  Flame,
  ShoppingBag,
  ShoppingCart,
  Mic,
  SlidersHorizontal,
  CheckCircle2,
  Bookmark,
  BadgePercent,
  X,
  ArrowRightLeft,
  ArrowDownUp,
  Timer,
  CalendarClock,
  ShieldCheck,
  IndianRupee,
  UtensilsCrossed,
  Leaf,
  AlertCircle,
  Loader2,
  Plus,
  Check,
  ChevronDown,
  ChevronRight,
  Share2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AddToCartButton from "@food/components/user/AddToCartButton";

const StickyCartCard = React.lazy(() => import("@food/components/user/StickyCartCard"));
const OrderTrackingCard = React.lazy(() => import("@food/components/user/OrderTrackingCard"));
import {
  CategoryChipRowSkeleton,
  ExploreGridSkeleton,
  HeroBannerSkeleton,
  LoadingSkeletonRegion,
  RestaurantGridSkeleton,
} from "@food/components/ui/loading-skeletons";
import { useProfile } from "@food/context/ProfileContext";
import { useCart } from "@food/context/CartContext";
import { HorizontalCarousel } from "@food/components/ui/horizontal-carousel";
import { DotPattern } from "@food/components/ui/dot-pattern";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { Badge } from "@food/components/ui/badge";
import { Input } from "@food/components/ui/input";
import { Switch } from "@food/components/ui/switch";
import { Checkbox } from "@food/components/ui/checkbox";
import {
  useSearchOverlay,
  useLocationSelector,
} from "@food/components/user/UserLayout";
import PageNavbar from "@food/components/user/PageNavbar";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

// Import shared food images - prevents duplication
import { foodImages } from "@food/constants/images";

import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";
import { useLocation } from "@food/hooks/useLocation";
import { useZone } from "@food/hooks/useZone";
import quickSpicyLogo from "@food/assets/k9-logo.jpg";
import offerImage from "@food/assets/offerimage.png";
import api, { publicGetOnce, restaurantAPI, adminAPI, orderAPI } from "@food/api";
import { API_BASE_URL } from "@food/api/config";
import OptimizedImage from "@food/components/OptimizedImage";

/**
 * Is this banner a video rather than an image?
 *
 * Matched on the URL because that is all the banner record carries -- there is no
 * media-type field on it. Cloudinary is special-cased: it serves video from a
 * /video/upload/ path and the delivery URL often carries no file extension at all,
 * so an extension check alone would render a video into an <img> and show nothing.
 */
const isVideoBannerUrl = (url) => {
  const value = String(url || "").trim().toLowerCase();
  if (!value) return false;
  if (value.includes("/video/upload/")) return true;
  return /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/.test(value);
};

import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";
import HomeHeader from "@food/components/user/home/HomeHeader";
import QuickSection from "@food/components/user/home/QuickSection";
import PromoRow from "@food/components/user/home/PromoRow";
import PromotionBannerCarousel from "@food/components/user/home/PromotionBannerCarousel";
import StaticPromoBanners from "@food/components/user/home/StaticPromoBanners";


// Explore More Icons
import exploreOffers from "@food/assets/explore more icons/offers.png";
import exploreGourmet from "@food/assets/explore more icons/gourmet.png";
import exploreTop10 from "@food/assets/explore more icons/top 10.png";
import exploreCollection from "@food/assets/explore more icons/collection.png";

// Banner images for hero carousel - will be fetched from API

// Animated placeholder for search - moved outside component to prevent recreation
const placeholders = [
  'Search "burger"',
  'Search "biryani"',
  'Search "pizza"',
  'Search "desserts"',
  'Search "chinese"',
  'Search "thali"',
  'Search "momos"',
  'Search "dosa"',
];

const WEBVIEW_SESSION_CACHE_BUSTER = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getRestaurantDisplayName = (restaurant) => {
  const nameCandidates = [
    restaurant?.name,
    restaurant?.restaurantName,
    restaurant?.restaurantName?.english,
    restaurant?.restaurantName?.value,
    restaurant?.onboarding?.step1?.restaurantName,
  ];
  const resolvedName = nameCandidates.find(
    (candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return resolvedName ? resolvedName.trim() : "Restaurant";
};

// Restaurant Image Carousel Component
const RestaurantImageCarousel = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72",
    roundedClass = "rounded-t-md",
  }) => {
    const webviewSessionKeyRef = useRef(WEBVIEW_SESSION_CACHE_BUSTER);
    const imageElementRef = useRef(null);

    const withCacheBuster = useCallback(
      (url) => {
        if (typeof url !== "string" || !url) return "";
        if (/^data:/i.test(url) || /^blob:/i.test(url)) return url;

        // Resolve relative URLs (e.g. /uploads/...) so they load on mobile when backend is different from frontend.
        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(url.trim());
        const resolvedUrl =
          backendOrigin && isRelative
            ? `${backendOrigin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
            : url;

        // Do not mutate signed URLs (legacy S3/Cloudfront/Firebase links can break if query changes).
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            resolvedUrl,
          );
        if (hasSignedParams) return resolvedUrl;

        try {
          const parsed = new URL(resolvedUrl, window.location.origin);

          // Apply cache-buster only to app/backend-hosted URLs to avoid third-party CDN signature issues.
          const currentHost =
            typeof window !== "undefined" ? window.location.hostname : "";
          const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(
            parsed.hostname,
          );
          const isSameHost = currentHost && parsed.hostname === currentHost;

          if (isLocalHost || isSameHost) {
            parsed.searchParams.set("_wv", webviewSessionKeyRef.current);
          }
          return parsed.toString();
        } catch {
          return resolvedUrl;
        }
      },
      [backendOrigin],
    );

    const images = useMemo(() => {
      const sourceImages =
        Array.isArray(restaurant.images) && restaurant.images.length > 0
          ? restaurant.images
          : [restaurant.image];

      const validImages = sourceImages
        .filter((img) => typeof img === "string")
        .map((img) => img.trim())
        .filter(Boolean);

      return validImages.map((img) => withCacheBuster(img));
    }, [restaurant.images, restaurant.image, withCacheBuster]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loadedBySrc, setLoadedBySrc] = useState({});
    const [, setAttemptedSrcs] = useState({});
    const [isImageUnavailable, setIsImageUnavailable] = useState(false);
    const [showShimmer, setShowShimmer] = useState(true);
    const [lastGoodSrc, setLastGoodSrc] = useState("");
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const isSwiping = useRef(false);

    const safeIndex =
      images.length > 0
        ? ((currentIndex % images.length) + images.length) % images.length
        : 0;
    const primarySrc = images[safeIndex] || "";
    const displaySrc = primarySrc;
    const renderSrc = displaySrc || lastGoodSrc;
    const isImageLoaded = Boolean(loadedBySrc[renderSrc] || lastGoodSrc);

    // Reset transient image state when restaurant or source list changes.
    useEffect(() => {
      setCurrentIndex(0);
      setLoadedBySrc({});
      setAttemptedSrcs({});
      setIsImageUnavailable(images.length === 0);
      setShowShimmer(images.length > 0);
    }, [restaurant?.id, restaurant?.slug, restaurant?.updatedAt, images]);

    const showMultipleImages = images.length > 1;

    useEffect(() => {
      let intervalId;
      if (showMultipleImages) {
        intervalId = setInterval(() => {
          if (!isSwiping.current) {
            setCurrentIndex((prev) => (prev + 1) % images.length);
          }
        }, 3500);
      }
      return () => {
        if (intervalId) clearInterval(intervalId);
      };
    }, [showMultipleImages, images.length]);

    // Clear sticky successful source only when card identity changes.
    useEffect(() => {
      setLastGoodSrc("");
    }, [restaurant?.id, restaurant?.slug]);

    // WebView can serve from cache without firing onLoad; handle already-complete images.
    useEffect(() => {
      if (!renderSrc) return;
      const imgEl = imageElementRef.current;
      if (!imgEl) return;

      setShowShimmer(true);
      const shimmerTimeout = setTimeout(() => {
        setShowShimmer(false);
      }, 2500);

      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) {
          setLoadedBySrc((prev) =>
            prev[renderSrc] ? prev : { ...prev, [renderSrc]: true },
          );
          setLastGoodSrc(renderSrc);
          setShowShimmer(false);
        } else {
          setAttemptedSrcs((prev) => ({ ...prev, [renderSrc]: true }));
        }
      }
      return () => clearTimeout(shimmerTimeout);
    }, [renderSrc]);

    // Handle touch events for swipe
    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      isSwiping.current = false;
    };

    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const diff = touchStartX.current - currentX;

      // If swipe distance is significant, mark as swiping
      if (Math.abs(diff) > 10) {
        isSwiping.current = true;
      }
    };

    const handleTouchEnd = (e) => {
      if (!isSwiping.current) return;

      touchEndX.current = e.changedTouches[0].clientX;
      const diff = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 85; // Keep card swipe less sensitive on mobile

      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) {
          // Swipe left - next image
          setCurrentIndex((prev) => (prev + 1) % images.length);
        } else {
          // Swipe right - previous image
          setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
        }
      }

      // Reset
      isSwiping.current = false;
      touchStartX.current = 0;
      touchEndX.current = 0;
    };

    const showMultipleImagesDef = images.length > 1;


    return (
      <div
        className={`relative ${className} w-full overflow-hidden ${roundedClass} flex-shrink-0 group`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>
        {showShimmer && !isImageUnavailable && Boolean(renderSrc) && (
          <div className="absolute inset-0 z-[1] overflow-hidden bg-gray-200">
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          </div>
        )}

        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-110">
          {renderSrc && (
            <img
              ref={imageElementRef}
              src={renderSrc}
              alt={`${restaurant.name} - Image ${safeIndex + 1}`}
              className="w-full h-full object-cover"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              onLoad={() => {
                setLoadedBySrc((prev) => ({ ...prev, [renderSrc]: true }));
                setLastGoodSrc(renderSrc);
                setShowShimmer(false);
              }}
              onError={() => {
                setAttemptedSrcs((prev) => {
                  const next = { ...prev, [primarySrc]: true };
                  const attemptedCount = Object.keys(next).length;

                  if (attemptedCount >= images.length) {
                    setIsImageUnavailable(true);
                  } else if (images.length > 1) {
                    setCurrentIndex(
                      (prevIndex) => (prevIndex + 1) % images.length,
                    );
                  }

                  return next;
                });
                if (images.length === 1) {
                  setIsImageUnavailable(true);
                }
              }}
            />
          )}
        </div>

        {isImageUnavailable && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-gray-100">
            <span className="text-xs text-gray-500">Image unavailable</span>
          </div>
        )}

        {/* Image Indicators - only show if more than 1 image */}
        {showMultipleImages && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex items-center z-10 -space-x-2">
            {images.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className="w-10 h-10 flex items-center justify-center focus:outline-none group/btn rounded-full"
                aria-label={`Go to image ${index + 1}`}>
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${index === currentIndex
                      ? "w-6 bg-white"
                      : "w-1.5 bg-white/50 group-hover/btn:bg-white/75"
                    }`}
                />
              </button>
            ))}
          </div>
        )}

        {/* Gradient Overlay on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full transition-transform duration-1000 group-hover:animate-shine" />
      </div>
    );
  },
);

const RecommendedFoodImageStrip = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72",
    roundedClass = "rounded-t-md",
  }) => {
    const dragStateRef = useRef({
      pointerId: null,
      startX: 0,
      startY: 0,
      isDragging: false,
    });

    const resolveImageSrc = useCallback(
      (value) => {
        if (!value) return "";
        const raw =
          typeof value === "string"
            ? value
            : typeof value === "object"
              ? value.image || value.url || value.src || ""
              : "";

        if (typeof raw !== "string") return "";
        const trimmed = raw.trim();
        if (!trimmed) return "";
        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(trimmed);
        return backendOrigin && isRelative
          ? `${backendOrigin.replace(/\/$/, "")}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`
          : trimmed;
      },
      [backendOrigin],
    );

    const stripImages = useMemo(() => {
      const list = Array.isArray(restaurant?.recommendedImages)
        ? restaurant.recommendedImages
        : [];

      const slides = [];

      for (const item of list) {
        const image = resolveImageSrc(item);
        if (!image) continue;
        slides.push({
          id: item?.id || `${image}-${slides.length}`,
          image,
          name: item?.name || restaurant?.featuredDish || restaurant?.name || "Dish",
        });
        if (slides.length >= 8) break;
      }

      return slides;
    }, [restaurant?.recommendedImages, restaurant?.featuredDish, restaurant?.name, resolveImageSrc]);

    const handlePointerDown = useCallback((event) => {
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        isDragging: false,
      };
    }, []);

    const handlePointerMove = useCallback((event) => {
      const dragState = dragStateRef.current;
      if (dragState.pointerId !== event.pointerId) return;

      const deltaX = Math.abs(event.clientX - dragState.startX);
      const deltaY = Math.abs(event.clientY - dragState.startY);
      if (deltaX > 8 && deltaX > deltaY) {
        dragState.isDragging = true;
      }
    }, []);

    const resetDragState = useCallback(() => {
      dragStateRef.current = {
        pointerId: null,
        startX: 0,
        startY: 0,
        isDragging: false,
      };
    }, []);

    const handleClickCapture = useCallback((event) => {
      if (!dragStateRef.current.isDragging) return;
      event.preventDefault();
      event.stopPropagation();
      resetDragState();
    }, [resetDragState]);

    const scrollContainerRef = useRef(null);

    useEffect(() => {
      let intervalId;
      if (stripImages.length > 1) {
        intervalId = setInterval(() => {
          const container = scrollContainerRef.current;
          if (container && !dragStateRef.current.isDragging) {
            const maxScrollLeft = container.scrollWidth - container.clientWidth;
            if (container.scrollLeft >= maxScrollLeft - 10) {
              container.scrollTo({ left: 0, behavior: "smooth" });
            } else {
              container.scrollBy({ left: container.clientWidth, behavior: "smooth" });
            }
          }
        }, 3500);
      }
      return () => {
        if (intervalId) clearInterval(intervalId);
      };
    }, [stripImages.length]);

    if (stripImages.length === 0) {
      return (
        <RestaurantImageCarousel
          restaurant={restaurant}
          priority={priority}
          backendOrigin={backendOrigin}
          className={className}
          roundedClass={roundedClass}
        />
      );
    }

    return (
      <div
        className={`relative ${className} w-full overflow-hidden ${roundedClass} bg-[#f5f5f5]`}
      >
        <div
          ref={scrollContainerRef}
          className="flex h-full overflow-x-auto overscroll-x-contain snap-x snap-mandatory [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={resetDragState}
          onPointerCancel={resetDragState}
          onClickCapture={handleClickCapture}
        >
          {stripImages.map((item, index) => (
            <div
              key={item.id || `${item.image}-${index}`}
              className="relative h-full w-full shrink-0 snap-start overflow-hidden bg-white"
            >
              <OptimizedImage
                src={item.image}
                alt={`${restaurant?.name || "Restaurant"} - ${item.name || "Recommended item"}`}
                className="h-full w-full"
                objectFit="cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                loading={priority && index < 2 ? "eager" : "lazy"}
                placeholder={priority && index === 0 ? "blur" : "empty"}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
            </div>
          ))}
        </div>
      </div>
    );
  },
);

export default function Home() {
  const HERO_BANNER_AUTO_SLIDE_MS = 3500;
  const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [heroSearch, setHeroSearch] = useState("");
  const { openSearch, closeSearch, searchValue, setSearchValue } =
    useSearchOverlay();
  const { openLocationSelector } = useLocationSelector();
  const { vegMode, setVegMode: setVegModeContext } = useProfile();
  const [prevVegMode, setPrevVegMode] = useState(vegMode);
  const [showVegModePopup, setShowVegModePopup] = useState(false);
  const [showSwitchOffPopup, setShowSwitchOffPopup] = useState(false);
  const [vegModeOption, setVegModeOption] = useState("all"); // "all" or "pure-veg"
  const [isApplyingVegMode, setIsApplyingVegMode] = useState(false);
  const [isSwitchingOffVegMode, setIsSwitchingOffVegMode] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, triangleLeft: 0 });
  const vegModeToggleRef = useRef(null);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [heroBannerImages, setHeroBannerImages] = useState([]);
  const [heroBannersData, setHeroBannersData] = useState([]); // Store full banner data with linked restaurants
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false);
  const [isCategoryStuck, setIsCategoryStuck] = useState(false);
  const [landingCategories, setLandingCategories] = useState([]);
  const [landingExploreMore, setLandingExploreMore] = useState([]);
  const [exploreMoreHeading, setExploreMoreHeading] = useState("Explore More");
  const [recommendedRestaurantIds, setRecommendedRestaurantIds] = useState([]);
  const [
    recommendedRestaurantsFromSettings,
    setRecommendedRestaurantsFromSettings,
  ] = useState([]);
  const [loadingLandingConfig, setLoadingLandingConfig] = useState(true);
  const [restaurantsData, setRestaurantsData] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [realCategories, setRealCategories] = useState([]);
  const [loadingRealCategories, setLoadingRealCategories] = useState(true);
  const [menuCategories, setMenuCategories] = useState([]);
  const [loadingMenuCategories, setLoadingMenuCategories] = useState(false);
  const [, setRestaurantDietMeta] = useState({});
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const [availabilityTick, setAvailabilityTick] = useState(Date.now());
  const RESTAURANTS_BATCH_SIZE = 9;
  const [visibleRestaurantCount, setVisibleRestaurantCount] = useState(
    RESTAURANTS_BATCH_SIZE,
  );
  const restaurantLoadMoreRef = useRef(null);
  const publicCategoriesCacheRef = useRef(new Map());
  const publicCategoriesInFlightRef = useRef(new Map());
  const isHandlingSwitchOff = useRef(false);
  const heroShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const categoryAnchorRef = useRef(null);
  const slugifyCategory = useCallback(
    (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [],
  );

  // Stable list of restaurant ids for menu-category union so we don't refetch menus
  // when `restaurantsData` changes for reasons like distance recalculation or outletTimings enrichment.
  const menuUnionRestaurantIdsKey = useMemo(() => {
    if (!Array.isArray(restaurantsData) || restaurantsData.length === 0) return "";
    return restaurantsData
      .map((r) => String(r?.restaurantId || r?.id || "").trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }, [restaurantsData]);

  const normalizeImageUrl = useCallback(
    (imageUrl) => {
      if (typeof imageUrl !== "string") return "";
      const trimmed = imageUrl.trim();
      if (!trimmed) return "";
      if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
        return trimmed;
      }
      const appProtocol =
        typeof window !== "undefined" ? window.location?.protocol : "";
      const appHost =
        typeof window !== "undefined" ? window.location?.hostname : "";

      let decoded = trimmed;
      try {
        let next = decodeURIComponent(decoded);
        while (next !== decoded) {
          decoded = next;
          next = decodeURIComponent(decoded);
        }
      } catch (_) {
        decoded = trimmed;
      }

      let normalizedInput = decoded
        .replace(/\\/g, "/")
        .replace(/^(https?):\/(?!\/)/i, "$1://")
        .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

      if (/^\/\//.test(normalizedInput)) {
        normalizedInput = `${appProtocol || "https:"}${normalizedInput}`;
      }

      // WebView can fail on unescaped spaces/special chars; keep URLs safely encoded.
      if (/^(https?:)?\/\//i.test(normalizedInput)) {
        try {
          const parsed = new URL(normalizedInput, window.location.origin);

          // In mobile production, localhost/127.0.0.1 inside image URLs is unreachable.
          // Use BACKEND_ORIGIN (API server) for image host, not frontend hostuploads are served by the backend.
          if (
            appHost &&
            appHost !== "localhost" &&
            appHost !== "127.0.0.1" &&
            /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
          ) {
            try {
              const backendUrl = new URL(BACKEND_ORIGIN);
              parsed.protocol = backendUrl.protocol;
              parsed.hostname = backendUrl.hostname;
              parsed.port = backendUrl.port;
            } catch {
              parsed.protocol = window.location.protocol;
              parsed.hostname = window.location.hostname;
              if (window.location.port) parsed.port = window.location.port;
            }
          }

          // Prevent mixed-content image blocking in HTTPS WebView.
          if (appProtocol === "https:" && parsed.protocol === "http:") {
            parsed.protocol = "https:";
          }

          const finalUrl = parsed.toString();
          // Do not encode signed URLs (S3/Cloudfront/Cloudinary); encoding query params can break signatures.
          const hasSignedParams =
            /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
              finalUrl,
            );
          return hasSignedParams ? finalUrl : encodeURI(finalUrl);
        } catch {
          return normalizedInput;
        }
      }

      const absolutePath = normalizedInput.startsWith("/")
        ? `${BACKEND_ORIGIN}${normalizedInput}`
        : `${BACKEND_ORIGIN}/${normalizedInput.replace(/^\.?\/*/, "")}`;

      try {
        const parsed = new URL(absolutePath, window.location.origin);
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:";
        }
        const finalUrl = parsed.toString();
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            finalUrl,
          );
        return hasSignedParams ? finalUrl : encodeURI(finalUrl);
      } catch {
        return absolutePath;
      }
    },
    [BACKEND_ORIGIN],
  );

  const extractImageFromValue = useCallback(
    (value) => {
      if (!value) return "";

      if (typeof value === "string") {
        return normalizeImageUrl(value);
      }

      if (typeof value === "object") {
        const candidate =
          value.url ||
          value.secure_url ||
          value.imageUrl ||
          value.imageURL ||
          value.image ||
          value.src ||
          value.path ||
          value.location ||
          value.link ||
          value.href ||
          "";
        return typeof candidate === "string"
          ? normalizeImageUrl(candidate)
          : "";
      }

      return "";
    },
    [normalizeImageUrl],
  );

  const buildRestaurantImageCandidates = useCallback(
    (value) => {
      const normalized = extractImageFromValue(value);
      if (!normalized) return [];

      // Mobile WebView safety: try deterministic JPEG first, then auto, then original.
      if (
        /res\.cloudinary\.com/i.test(normalized) &&
        /\/image\/upload\//i.test(normalized)
      ) {
        const hasTransform =
          /\/image\/upload\/(?:f_|q_|w_|h_|c_|dpr_|g_)/i.test(normalized);
        if (!hasTransform) {
          return Array.from(
            new Set([
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_jpg,q_auto,w_1080/",
              ),
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_auto,q_auto,w_1080/",
              ),
              normalized,
            ]),
          );
        }
      }

      return [normalized];
    },
    [extractImageFromValue],
  );

  const extractImages = useCallback(
    (source) => {
      if (!source) return [];

      const normalizedImages = (Array.isArray(source)
        ? source.flatMap((entry) => buildRestaurantImageCandidates(entry))
        : buildRestaurantImageCandidates(source)
      )
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean);

      // De-duplicate image urls while preserving order.
      return normalizedImages.filter(
        (value, index) => normalizedImages.indexOf(value) === index,
      );

    },
    [buildRestaurantImageCandidates],
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now());
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const heroShell = heroShellRef.current;
      const stickyHeader = stickyHeaderRef.current;

      if (!heroShell) {
        setHasScrolledPastBanner(false);
        return;
      }

      const heroRect = heroShell.getBoundingClientRect();
      const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0;
      setHasScrolledPastBanner(heroRect.bottom <= stickyHeight);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Fire when sentinel hits 72px from top (matches sticky top value)
        setIsCategoryStuck(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '-72px 0px 0px 0px' }
    );
    if (categoryAnchorRef.current) observer.observe(categoryAnchorRef.current);
    return () => observer.disconnect();
  }, []);


  // Merge API explore items with fallback to ensure all 4 cards are shown
  const finalExploreItems = useMemo(() => {
    const fallback = [
      {
        id: "offers",
        label: "Offers",
        image: exploreOffers,
        href: "/food/user/offers",
      },
      {
        id: "gourmet",
        label: "Gourmet",
        image: exploreGourmet,
        href: "/food/user/gourmet",
      },
      {
        id: "collection",
        label: "Collections",
        image: exploreCollection,
        href: "/food/user/profile/favorites",
      },
    ];

    if (!landingExploreMore || landingExploreMore.length === 0) return fallback;

    return fallback.map((item) => {
      const apiItem = landingExploreMore.find(
        (ai) => ai.label?.toLowerCase() === item.label?.toLowerCase(),
      );
      if (apiItem) {
        const href = apiItem.link
          ? apiItem.link.startsWith("/")
            ? apiItem.link
            : `/${apiItem.link}`
          : item.href;
        return {
          ...item,
          image:
            normalizeImageUrl(apiItem.imageUrl || apiItem.image || "") ||
            item.image,
          href,
        };
      }
      return item;
    });
  }, [landingExploreMore, normalizeImageUrl]);

  const normalizedLandingCategories = useMemo(() => {
    return (landingCategories || []).map((category, index) => ({
      id: category.id || category._id || `landing-category-${index}`,
      name: category.label || category.name || "Category",
      image:
        normalizeImageUrl(category.imageUrl || category.image) ||
        foodImages[index % foodImages.length] ||
        foodImages[0],
      slug:
        category.slug || slugifyCategory(category.label || category.name || ""),
      label: category.label || category.name || "Category",
    }));
  }, [landingCategories, normalizeImageUrl, slugifyCategory]);

  const displayCategories = useMemo(() => {
    if (realCategories.length > 0) return realCategories;
    if (menuCategories.length > 0) return menuCategories;
    return normalizedLandingCategories;
  }, [menuCategories, realCategories, normalizedLandingCategories]);

  // Swipe functionality for hero banner carousel
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const autoSlideIntervalRef = useRef(null);

  // Sync prevVegMode when vegMode changes from context
  useEffect(() => {
    if (vegMode !== prevVegMode && !isHandlingSwitchOff.current) {
      setPrevVegMode(vegMode);
    }
  }, [vegMode]);

  // Keep persisted Veg Mode preference; only reset popup UI state on mount.
  useEffect(() => {
    setPrevVegMode(vegMode);
    setShowVegModePopup(false);
    setShowSwitchOffPopup(false);
    setVegModeOption("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle vegMode toggle - show popup when turned ON or OFF
  const handleVegModeChange = (newValue) => {
    // Skip if we're handling switch off confirmation
    if (isHandlingSwitchOff.current) {
      return;
    }

    if (newValue && !prevVegMode) {
      // Veg mode was just turned ON
      // Calculate popup position relative to toggle
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320); // 320 is max-w-xs

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
      setShowVegModePopup(true);
      // Don't update context yet - wait for user to apply or cancel
    } else if (!newValue && prevVegMode) {
      // Veg mode was just turned OFF - show switch off confirmation popup
      isHandlingSwitchOff.current = true;
      setShowSwitchOffPopup(true);
      // Don't update context yet - wait for user to confirm
    } else {
      // Normal state change - update context directly
      setVegModeContext(newValue);
      setPrevVegMode(newValue);
    }
  };

  // Update popup position on scroll/resize
  useEffect(() => {
    if (!showVegModePopup) return;

    const updatePosition = () => {
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showVegModePopup]);

  // Fetch hero banners from public API (no auth required)
  useEffect(() => {
    let cancelled = false;
    setLoadingBanners(true);
    publicGetOnce("/food/showcase-items/public")
      .then((response) => {
        if (cancelled) return;
        const data = response?.data?.data;
        const list = Array.isArray(data?.banners)
          ? data.banners
          : Array.isArray(data)
            ? data
            : [];
        const images = list
          .map((b) => (b && typeof b.imageUrl === "string" ? b.imageUrl : ""))
          .filter(Boolean);
        setHeroBannerImages(images);
        setHeroBannersData(list);
        setCurrentBannerIndex(0);
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Failed to fetch hero banners", err);
        setHeroBannerImages([]);
        setHeroBannersData([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBanners(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Old backend endpoint removed: keep UI stable with empty categories.
  useEffect(() => {
    setLoadingRealCategories(true);
    setRealCategories([]);
    setLoadingRealCategories(false);
  }, []);

  // Fetch explore icons and landing settings from public APIs
  useEffect(() => {
    let cancelled = false;
    setLoadingLandingConfig(true);
    Promise.all([
      publicGetOnce("/food/explore-icons/public")
        .catch(() => ({ data: { data: {} } })),
      publicGetOnce("/food/landing/settings/public")
        .catch(() => ({ data: { data: {} } })),
    ])
      .then(([exploreRes, settingsRes]) => {
        if (cancelled) return;
        const exploreData = exploreRes?.data?.data;
        const items = Array.isArray(exploreData?.items)
          ? exploreData.items
          : Array.isArray(exploreData)
            ? exploreData
            : [];
        setLandingExploreMore(
          items.map((it) => ({
            ...it,
            imageUrl: it.imageUrl || it.iconUrl,
            label: it.label || it.name,
          })),
        );
        const settings = settingsRes?.data?.data || {};
        setExploreMoreHeading(settings.exploreMoreHeading || "Explore More");
        setRecommendedRestaurantIds(settings.recommendedRestaurantIds || []);
        setRecommendedRestaurantsFromSettings(
          settings.recommendedRestaurants || [],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLandingExploreMore([]);
          setExploreMoreHeading("Explore More");
          setRecommendedRestaurantsFromSettings([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLandingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep index within current banner bounds after admin updates/reloads.
  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (heroBannerImages.length === 0) return 0;
      return Math.min(prev, heroBannerImages.length - 1);
    });
  }, [heroBannerImages.length]);

  // Preload hero images to avoid white blink during slide transition.
  useEffect(() => {
    heroBannerImages.forEach((src) => {
      if (!src) return;
      const img = new window.Image();
      img.src = src;
    });
  }, [heroBannerImages]);

  const startHeroBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current);
    }

    if (heroBannerImages.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isSwiping.current) {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
    }, HERO_BANNER_AUTO_SLIDE_MS);
  }, [heroBannerImages.length, HERO_BANNER_AUTO_SLIDE_MS]);

  // Auto-cycle hero banner images
  useEffect(() => {
    startHeroBannerAutoSlide();

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
      }
    };
  }, [startHeroBannerAutoSlide]);

  // Helper function to reset auto-slide timer
  const resetAutoSlide = useCallback(() => {
    startHeroBannerAutoSlide();
  }, [startHeroBannerAutoSlide]);

  // Swipe handlers for hero banner carousel
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50; // Minimum distance for a swipe

    // Check if it's a horizontal swipe (not vertical scroll)
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        // Swipe right - go to previous image
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        // Swipe left - go to next image
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    // Reset swipe state after a short delay
    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    // Reset touch positions
    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };

  // Mouse handlers for desktop drag support
  const handleMouseDown = (e) => {
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    isSwiping.current = true;
  };

  const handleMouseMove = (e) => {
    if (!isSwiping.current) return;
    touchEndX.current = e.clientX;
    touchEndY.current = e.clientY;
  };

  const handleMouseUp = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };
  const [previouslyOrderedRestaurants, setPreviouslyOrderedRestaurants] = useState([]);
  const [loadingPreviouslyOrdered, setLoadingPreviouslyOrdered] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchPastOrders = async () => {
      const isAuth =
        localStorage.getItem("user_accessToken") ||
        localStorage.getItem("user_authenticated") === "true" ||
        localStorage.getItem("accessToken");
      if (!isAuth) return;
      setLoadingPreviouslyOrdered(true);
      try {
        const response = await orderAPI.getOrders({ limit: 50, page: 1 });
        if (!isMounted) return;

        let rawOrders = [];
        if (response?.data?.success && response?.data?.data?.orders) {
          rawOrders = response.data.data.orders;
        } else if (response?.data?.orders) {
          rawOrders = response.data.orders;
        } else if (response?.data?.data && Array.isArray(response.data.data)) {
          rawOrders = response.data.data;
        }

        const map = new Map();
        rawOrders.forEach((order) => {
          const rest = order.restaurantId;
          if (rest && rest._id && !map.has(rest._id)) {
            const deliveryTime = rest.estimatedDeliveryTime || rest.deliveryTime || "25-30 mins";
            const coverImages = Array.isArray(rest.coverImages)
              ? rest.coverImages
              : [rest.coverImage || rest.profileImage].filter(Boolean);
            const allImages = extractImages([
              ...coverImages,
              rest.profileImage,
              rest.image
            ].filter(Boolean));
            map.set(rest._id, {
              id: rest.restaurantId || rest._id,
              mongoId: rest._id,
              name: getRestaurantDisplayName(rest),
              coverImages: coverImages,
              profileImage: rest.profileImage || rest.image || "",
              images: allImages,
              image: allImages[0] || "",
              rating: Number(rest.rating) || 0,
              deliveryTime: deliveryTime,
              slug: rest.slug || rest._id,
              cuisines: Array.isArray(rest.cuisines) ? rest.cuisines : [],
              cuisine: rest.cuisines?.[0] || "Multi-cuisine",
            });
          }
        });
        setPreviouslyOrderedRestaurants(Array.from(map.values()));
      } catch (err) {
        debugError("Failed to fetch past orders", err);
      } finally {
        if (isMounted) {
          setLoadingPreviouslyOrdered(false);
        }
      }
    };
    fetchPastOrders();
    return () => {
      isMounted = false;
    };
  }, []);

  const [activeFilters, setActiveFilters] = useState(new Set());
  const [sortBy, setSortBy] = useState(null); // null, 'price-low', 'price-high', 'rating-high', 'rating-low'
  const [selectedCuisine, setSelectedCuisine] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    activeFilters: new Set(),
    sortBy: null,
    selectedCuisine: null,
  });
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false);
  const [activeFilterTab, setActiveFilterTab] = useState("sort");
  const categoryScrollRef = useRef(null);
  const gsapAnimationsRef = useRef([]);
  // Show skeletons immediately while loading â€” delayed toggles caused visible layout swap (CLS).
  const showBannerSkeleton = loadingBanners;
  const showCategorySkeleton = loadingRealCategories || loadingMenuCategories;
  const showExploreSkeleton = loadingLandingConfig;
  const showRestaurantSkeleton = isLoadingFilterResults || loadingRestaurants;
  // Safely get profile context - handle case when ProfileProvider is not available
  let profileContext = null;
  try {
    profileContext = useProfile();
  } catch (error) {
    debugWarn("ProfileProvider not available, using fallback:", error.message);
    // Fallback values when ProfileProvider is not available
    profileContext = {
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      getDefaultAddress: () => null,
    };
  }

  const {
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
    getDefaultAddress,
  } = profileContext;
  const { addToCart, cart } = useCart();
  const { location, loading, requestLocation } = useLocation();
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    if (typeof window === "undefined") return "saved";
    return window.localStorage.getItem("deliveryAddressMode") || "saved";
  });

  const defaultSavedAddress = useMemo(
    () => getDefaultAddress?.() || null,
    [getDefaultAddress],
  );

  const defaultSavedAddressLocation = useMemo(() => {
    const coords = defaultSavedAddress?.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }

    const lat = Number(
      defaultSavedAddress?.latitude || defaultSavedAddress?.lat,
    );
    const lng = Number(
      defaultSavedAddress?.longitude || defaultSavedAddress?.lng,
    );
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }

    return null;
  }, [defaultSavedAddress]);

  const savedLocationCache = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("userLocation");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const lat = Number(parsed?.latitude);
      const lng = Number(parsed?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        latitude: lat,
        longitude: lng,
        city: parsed?.city || "",
        state: parsed?.state || "",
        address: parsed?.address || "",
        formattedAddress: parsed?.formattedAddress || "",
      };
    } catch {
      return null;
    }
  }, [deliveryAddressMode, defaultSavedAddress?.id, defaultSavedAddress?._id]);

  const effectiveLocation = useMemo(() => {
    const useSavedAddress =
      deliveryAddressMode === "saved" &&
      (Number.isFinite(defaultSavedAddressLocation?.latitude) &&
        Number.isFinite(defaultSavedAddressLocation?.longitude)) ||
      (Number.isFinite(savedLocationCache?.latitude) &&
        Number.isFinite(savedLocationCache?.longitude));

    if (!useSavedAddress) return location;
    return defaultSavedAddressLocation || savedLocationCache || location;
  }, [deliveryAddressMode, defaultSavedAddressLocation, savedLocationCache, location]);

  const {
    zoneId,
    zoneStatus,
    isInService,
    isOutOfService,
    loading: zoneLoading,
    error: zoneError,
    refreshZone,
  } = useZone(effectiveLocation);
  const [showToast, setShowToast] = useState(false);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState(null);

  // Fetch admin categories as global for homepage category rail.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const zoneKey = "global-admin-categories"
      try {
        // Dedupe repeated calls (StrictMode + zone settling). Cache per zoneKey and share in-flight request.
        const cached = publicCategoriesCacheRef.current.get(zoneKey)
        if (cached) {
          if (!cancelled) setRealCategories(cached)
          return
        }

        const inFlight = publicCategoriesInFlightRef.current.get(zoneKey)
        if (inFlight) {
          const categories = await inFlight
          if (!cancelled) setRealCategories(categories)
          return
        }

        setLoadingRealCategories(true)
        const promise = (async () => {
          const res = await adminAPI.getPublicCategories({})
          const list =
            res?.data?.data?.categories ||
            res?.data?.categories ||
            []
          const categories = Array.isArray(list)
            ? list.map((cat, idx) => ({
              id: String(cat?.id || cat?._id || cat?.slug || idx),
              name: cat?.name || "",
              slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
              image:
                normalizeImageUrl(cat?.image || cat?.imageUrl) ||
                foodImages[idx % foodImages.length] ||
                foodImages[0],
              type: cat?.type || "",
            }))
            : []

          publicCategoriesCacheRef.current.set(zoneKey, categories)
          return categories
        })()

        publicCategoriesInFlightRef.current.set(zoneKey, promise)
        const categories = await promise
        publicCategoriesInFlightRef.current.delete(zoneKey)

        if (!cancelled) setRealCategories(categories)
      } catch (err) {
        debugWarn("Failed to fetch categories:", err)
        if (!cancelled) setRealCategories([])
      } finally {
        if (!cancelled) setLoadingRealCategories(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [normalizeImageUrl])

  // Memoize cartCount to prevent recalculation on every render - use cart directly
  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + (item.quantity || 0), 0),
    [cart],
  );

  useEffect(() => {
    const readMode = () => {
      if (typeof window === "undefined") return;
      const nextMode =
        window.localStorage.getItem("deliveryAddressMode") || "saved";
      setDeliveryAddressMode(nextMode);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") readMode();
    };

    window.addEventListener("focus", readMode);
    window.addEventListener("storage", readMode);
    window.addEventListener("deliveryAddressModeChanged", readMode);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", readMode);
      window.removeEventListener("storage", readMode);
      window.removeEventListener("deliveryAddressModeChanged", readMode);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (
      !Number.isFinite(effectiveLocation?.latitude) ||
      !Number.isFinite(effectiveLocation?.longitude)
    ) {
      return;
    }

    // Force a zone sync when effective delivery source changes
    // (saved/current toggle, saved default address change, location source updates).
    refreshZone();
  }, [
    deliveryAddressMode,
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    refreshZone,
  ]);

  const cityName = effectiveLocation?.city || "Select";
  const stateName = effectiveLocation?.state || "Location";
  const hasLiveLocation = useMemo(() => {
    if (!effectiveLocation) return false;

    const isPlaceholder = (value) => {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return (
        !normalized ||
        normalized === "select location" ||
        normalized === "current location"
      );
    };

    const hasAddressText =
      !isPlaceholder(effectiveLocation.formattedAddress) ||
      !isPlaceholder(effectiveLocation.address);
    const hasCityState =
      !isPlaceholder(effectiveLocation.city) || !isPlaceholder(effectiveLocation.state);

    return hasAddressText || hasCityState;
  }, [effectiveLocation]);

  const formatSavedAddress = useCallback((address) => {
    if (!address) return "";

    if (
      address.formattedAddress &&
      address.formattedAddress !== "Select location"
    ) {
      return address.formattedAddress;
    }

    const parts = [];
    if (address.additionalDetails) parts.push(address.additionalDetails);
    if (address.street) parts.push(address.street);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.zipCode) parts.push(address.zipCode);

    if (parts.length > 0) return parts.join(", ");
    if (address.address && address.address !== "Select location")
      return address.address;

    return "";
  }, []);

  const savedAddressText = useMemo(() => {
    return formatSavedAddress(defaultSavedAddress);
  }, [defaultSavedAddress, formatSavedAddress]);

  const headerSavedAddressText =
    deliveryAddressMode === "saved" ? savedAddressText : "";

  // Mock points value - replace with actual points from context/store
  const userPoints = 99;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("food");


  // Simple filter toggle function
  const toggleFilter = (filterId) => {
    setActiveFilters((prev) => {
      const newSet = new Set(prev);
      if (filterId === "rating-4-plus") {
        newSet.delete("rating-35-plus");
        newSet.delete("rating-45-plus");
      } else if (filterId === "rating-35-plus") {
        newSet.delete("rating-4-plus");
        newSet.delete("rating-45-plus");
      } else if (filterId === "rating-45-plus") {
        newSet.delete("rating-4-plus");
        newSet.delete("rating-35-plus");
      }

      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };


  // Refs for scroll tracking
  const filterSectionRefs = useRef({});
  const [activeScrollSection, setActiveScrollSection] = useState("sort");
  const rightContentRef = useRef(null);
  const restaurantsRequestSeqRef = useRef(0);
  const menuUnionRequestSeqRef = useRef(0);
  const menuUnionCacheRef = useRef(new Map());

  // Scroll tracking effect
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return;

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("data-section-id");
          if (sectionId) {
            setActiveScrollSection(sectionId);
            setActiveFilterTab(sectionId);
          }
        }
      });
    }, observerOptions);

    // Observe all filter sections
    Object.values(filterSectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isFilterOpen]);

  // Fetch restaurants from API with filters
  const fetchRestaurants = useCallback(
    async (filters = {}) => {
      const requestSeq = ++restaurantsRequestSeqRef.current;
      try {
        setLoadingRestaurants(true);

        // Backend disconnected - new backend in progress. Skip health check.

        // Build query parameters from filters
        const params = {};

        // Always send user coordinates when available so backend can compute distance/sort.
        if (
          Number.isFinite(effectiveLocation?.latitude) &&
          Number.isFinite(effectiveLocation?.longitude)
        ) {
          params.lat = effectiveLocation.latitude;
          params.lng = effectiveLocation.longitude;
        }

        // Sort by
        if (filters.sortBy) {
          params.sortBy = filters.sortBy;
        }

        // Cuisine
        if (filters.selectedCuisine) {
          params.cuisine = filters.selectedCuisine;
        }

        // Rating filters
        if (filters.activeFilters?.has("rating-45-plus")) {
          params.minRating = 4.5;
        } else if (filters.activeFilters?.has("rating-4-plus")) {
          params.minRating = 4.0;
        } else if (filters.activeFilters?.has("rating-35-plus")) {
          params.minRating = 3.5;
        }

        // Delivery time filters
        if (filters.activeFilters?.has("delivery-under-30")) {
          params.maxDeliveryTime = 30;
        } else if (filters.activeFilters?.has("delivery-under-45")) {
          params.maxDeliveryTime = 45;
        }

        // Distance filters
        if (filters.activeFilters?.has("distance-under-1km")) {
          params.radiusKm = 1.0;
        } else if (filters.activeFilters?.has("distance-under-2km")) {
          params.radiusKm = 2.0;
        }

        // Price filters
        if (filters.activeFilters?.has("price-under-200")) {
          params.maxPrice = 200;
        } else if (filters.activeFilters?.has("price-under-500")) {
          params.maxPrice = 500;
        }

        // Offers filter
        if (filters.activeFilters?.has("has-offers")) {
          params.hasOffers = "true";
        }

        // Trust filters
        if (filters.activeFilters?.has("top-rated")) {
          params.topRated = "true";
        } else if (filters.activeFilters?.has("trusted")) {
          params.trusted = "true";
        }

        // Allow fetching global restaurants on the homepage regardless of detected zone.
        // if (zoneId) {
        //   params.zoneId = zoneId;
        // }

        debugLog("Fetching restaurants with params:", params);
        const response = await restaurantAPI.getRestaurants(params);
        debugLog("Restaurants API response:", response.data);

        // If a newer request started, ignore this response to avoid races/flicker.
        if (requestSeq !== restaurantsRequestSeqRef.current) return;

        if (
          response.data &&
          response.data.success &&
          response.data.data &&
          response.data.data.restaurants
        ) {
          const restaurantsArray = response.data.data.restaurants;
          debugLog(`Fetched ${restaurantsArray.length} restaurants from API`);

          if (restaurantsArray.length === 0) {
            debugWarn("No restaurants found in API response");
            setRestaurantsData([]);
            return;
          }

          // Calculate distance helper function
          const calculateDistance = (lat1, lng1, lat2, lng2) => {
            const R = 6371; // Earth's radius in kilometers
            const dLat = ((lat2 - lat1) * Math.PI) / 180;
            const dLng = ((lng2 - lng1) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c; // Distance in kilometers
          };

          // Get user coordinates
          const userLat = effectiveLocation?.latitude;
          const userLng = effectiveLocation?.longitude;

          // Transform API data to match expected format
          const transformedRestaurants = restaurantsArray
            .filter((restaurant) => {
              const name = (restaurant.restaurantName || restaurant.name || "").toLowerCase()
              return true
            })
            .map((restaurant, index) => {
              // Use restaurant data if available, otherwise use defaults
              const deliveryTime =
                restaurant.estimatedDeliveryTime || "25-30 mins";

              // Calculate distance from user to restaurant
              let distance = restaurant.distance || "1.2 km";

              // Get restaurant coordinates
              const restaurantLocation = restaurant.location;
              const restaurantLat =
                restaurantLocation?.latitude ||
                (restaurantLocation?.coordinates &&
                  Array.isArray(restaurantLocation.coordinates)
                  ? restaurantLocation.coordinates[1]
                  : null);
              const restaurantLng =
                restaurantLocation?.longitude ||
                (restaurantLocation?.coordinates &&
                  Array.isArray(restaurantLocation.coordinates)
                  ? restaurantLocation.coordinates[0]
                  : null);

              // Calculate distance if both user and restaurant coordinates are available
              let distanceInKm = null;
              if (
                userLat &&
                userLng &&
                restaurantLat &&
                restaurantLng &&
                !isNaN(userLat) &&
                !isNaN(userLng) &&
                !isNaN(restaurantLat) &&
                !isNaN(restaurantLng)
              ) {
                distanceInKm = calculateDistance(
                  userLat,
                  userLng,
                  restaurantLat,
                  restaurantLng,
                );
                // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
                if (distanceInKm >= 1) {
                  distance = `${distanceInKm.toFixed(1)} km`;
                } else {
                  const distanceInMeters = Math.round(distanceInKm * 1000);
                  distance = `${distanceInMeters} m`;
                }
              }

              // Get first cuisine or default
              const cuisine =
                restaurant.cuisines && restaurant.cuisines.length > 0
                  ? restaurant.cuisines[0]
                  : "Multi-cuisine";

              // Legacy-safe image extraction (supports old schema variants).
              const coverImages = extractImages([
                ...(Array.isArray(restaurant.coverImages) ? restaurant.coverImages : [restaurant.coverImages]).filter(Boolean),
                restaurant.coverImage,
              ]);

              const profileImageCandidates = extractImages([
                ...buildRestaurantImageCandidates(restaurant.profileImage),
                ...buildRestaurantImageCandidates(
                  restaurant.onboarding?.step2?.profileImageUrl,
                ),
                ...buildRestaurantImageCandidates(restaurant.image),
                ...buildRestaurantImageCandidates(restaurant.imageUrl),
              ]);
              const profileImageUrl = profileImageCandidates[0] || "";

              const allImages = Array.from(
                new Set(
                  [
                    ...coverImages,
                    ...profileImageCandidates,
                  ].filter(Boolean),
                ),
              );

              // Keep single image for backward compatibility
              const image = allImages[0] || profileImageUrl || "";
              const offerText = restaurant.offer || null;
              const recommendedImages = Array.isArray(restaurant.recommendedImages)
                ? restaurant.recommendedImages
                  .map((item, itemIndex) => {
                    const image = normalizeImageUrl(
                      item?.image || item?.url || item?.src || "",
                    );
                    if (!image) return null;
                    return {
                      id:
                        item?.id ||
                        item?._id ||
                        `${restaurant.restaurantId || restaurant._id || "restaurant"}-recommended-${itemIndex}`,
                      image,
                      name: item?.name || "",
                    };
                  })
                  .filter(Boolean)
                : [];

              return {
                id: restaurant.restaurantId || restaurant._id,
                mongoId: restaurant._id || null,
                name: getRestaurantDisplayName(restaurant),
                cuisine: cuisine,
                cuisines: Array.isArray(restaurant.cuisines)
                  ? restaurant.cuisines
                  : [],
                rating: Number(restaurant.rating) || 0,
                deliveryTime:
                  restaurant.deliveryTime ||
                  restaurant.estimatedDeliveryTime ||
                  (restaurant.estimatedDeliveryTimeMinutes
                    ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
                    : deliveryTime),
                distance: distance,
                distanceInKm: distanceInKm, // Store numeric distance for sorting
                image: image,
                images: allImages, // Array of cover images for carousel (separate from menu images)
                recommendedImages,
                priceRange: restaurant.priceRange || "$$", // Use from API or default
                featuredDish:
                  restaurant.featuredDish ||
                  (restaurant.cuisines && restaurant.cuisines.length > 0
                    ? `${restaurant.cuisines[0]} Special`
                    : "Special Dish"),
                featuredPrice: restaurant.featuredPrice || 249, // Use from API or default
                offer: offerText,
                slug: restaurant.slug,
                restaurantId: restaurant.restaurantId,
                pureVegRestaurant: restaurant.pureVegRestaurant === true,
                location: restaurant.location, // Store location for distance recalculation
                isActive: restaurant.isActive !== false, // Default to true if not specified
                isAcceptingOrders: restaurant.isAcceptingOrders !== false, // Default to true if not specified
                openDays: Array.isArray(restaurant.openDays)
                  ? restaurant.openDays
                  : [],
                deliveryTimings: restaurant.deliveryTimings || null,
                outletTimings: restaurant.outletTimings || null,
                openingTime: restaurant.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant.closingTime || restaurant?.deliveryTimings?.closingTime || null,
              };
            },
            );

          const sortRestaurantsForDisplay = (restaurants) => {
            if (!userLat || !userLng) return restaurants;
            return [...restaurants].sort((a, b) => {
              // Available restaurants first, then unavailable
              const aAvailable = getRestaurantAvailabilityStatus(
                a,
                new Date(),
                { ignoreOperationalStatus: true },
              ).isOpen;
              const bAvailable = getRestaurantAvailabilityStatus(
                b,
                new Date(),
                { ignoreOperationalStatus: true },
              ).isOpen;

              if (aAvailable !== bAvailable) {
                return aAvailable ? -1 : 1; // Available restaurants come first
              }

              // Apply secondary sort based on sortBy filter
              if (filters.sortBy === "price-low") {
                return (a.featuredPrice || 0) - (b.featuredPrice || 0);
              }
              if (filters.sortBy === "price-high") {
                return (b.featuredPrice || 0) - (a.featuredPrice || 0);
              }
              if (filters.sortBy === "rating-high") {
                return (b.rating || 0) - (a.rating || 0);
              }
              if (filters.sortBy === "rating-low") {
                return (a.rating || 0) - (b.rating || 0);
              }

              // Default: sort by distance
              const aDistance =
                a.distanceInKm !== null ? a.distanceInKm : Infinity;
              const bDistance =
                b.distanceInKm !== null ? b.distanceInKm : Infinity;
              return aDistance - bDistance;
            });
          };

          debugLog(
            "Transformed and sorted restaurants:",
            transformedRestaurants,
          );
          startTransition(() => {
            setRestaurantsData(sortRestaurantsForDisplay(transformedRestaurants));
          });

          const restaurantsNeedingOutletTimings = transformedRestaurants.filter(
            (restaurant) => restaurant.mongoId && !restaurant.outletTimings,
          );

          if (restaurantsNeedingOutletTimings.length > 0) {
            void (async () => {
              const resolvedOutletTimings = new Map();

              for (const restaurant of restaurantsNeedingOutletTimings) {
                try {
                  const outletResponse =
                    await restaurantAPI.getOutletTimingsByRestaurantId(
                      restaurant.mongoId,
                      { noCache: true },
                    );
                  const outletTimings =
                    outletResponse?.data?.data?.outletTimings ||
                    outletResponse?.data?.outletTimings ||
                    null;

                  if (outletTimings) {
                    resolvedOutletTimings.set(restaurant.mongoId, outletTimings);
                  }
                } catch (_) {
                  // Keep the existing restaurant data if enrichment fails.
                }
              }

              if (
                requestSeq !== restaurantsRequestSeqRef.current ||
                resolvedOutletTimings.size === 0
              ) {
                return;
              }

              startTransition(() => {
                setRestaurantsData((currentRestaurants) => {
                  let hasChanges = false;
                  const nextRestaurants = currentRestaurants.map((restaurant) => {
                    if (!restaurant.mongoId) return restaurant;
                    const outletTimings = resolvedOutletTimings.get(
                      restaurant.mongoId,
                    );
                    if (!outletTimings) return restaurant;
                    hasChanges = true;
                    return { ...restaurant, outletTimings };
                  });

                  return hasChanges
                    ? sortRestaurantsForDisplay(nextRestaurants)
                    : currentRestaurants;
                });
              });
            })();
          }
        } else {
          debugWarn("Invalid API response structure:", response.data);
          setRestaurantsData([]);
        }
      } catch (error) {
        debugError("Error fetching restaurants:", error);
        debugError("Error details:", error.response?.data || error.message);
        // Don't set hardcoded data here - let the useMemo fallback handle it
        // This way, if API succeeds later, it will show the real data
        setRestaurantsData([]);
      } finally {
        if (requestSeq === restaurantsRequestSeqRef.current) {
          setLoadingRestaurants(false);
        }
      }
    },
    [
      extractImages,
      buildRestaurantImageCandidates,
      effectiveLocation?.latitude,
      effectiveLocation?.longitude,
      zoneId,
    ],
  );

  const applyFiltersAndRefetch = useCallback(
    async (
      nextActiveFilters = activeFilters,
      nextSortBy = sortBy,
      nextSelectedCuisine = selectedCuisine,
    ) => {
      const nextFilterState = {
        activeFilters: new Set(nextActiveFilters),
        sortBy: nextSortBy,
        selectedCuisine: nextSelectedCuisine,
      };

      setAppliedFilters(nextFilterState);
      setIsLoadingFilterResults(true);

      try {
        await fetchRestaurants(nextFilterState);
      } catch (error) {
        debugError("Error applying filters:", error);
      } finally {
        setIsLoadingFilterResults(false);
      }
    },
    [activeFilters, sortBy, selectedCuisine, fetchRestaurants],
  );

  const handleToggleHorizontalFilter = useCallback((filterId) => {
    setActiveFilters((prev) => {
      const nextActiveFilters = new Set(prev);
      if (filterId === "rating-4-plus") {
        nextActiveFilters.delete("rating-35-plus");
        nextActiveFilters.delete("rating-45-plus");
      } else if (filterId === "rating-35-plus") {
        nextActiveFilters.delete("rating-4-plus");
        nextActiveFilters.delete("rating-45-plus");
      } else if (filterId === "rating-45-plus") {
        nextActiveFilters.delete("rating-4-plus");
        nextActiveFilters.delete("rating-35-plus");
      }

      if (nextActiveFilters.has(filterId)) {
        nextActiveFilters.delete(filterId);
      } else {
        nextActiveFilters.add(filterId);
      }

      applyFiltersAndRefetch(nextActiveFilters, sortBy, selectedCuisine);
      return nextActiveFilters;
    });
  }, [sortBy, selectedCuisine, applyFiltersAndRefetch]);

  // Fetch restaurants when appliedFilters change
  useEffect(() => {
    fetchRestaurants(appliedFilters);
  }, [appliedFilters, fetchRestaurants]);

  // Recalculate distances when user location updates
  useEffect(() => {
    if (!effectiveLocation?.latitude || !effectiveLocation?.longitude) return;

    setRestaurantsData((prevData) => {
      if (!prevData || prevData.length === 0) return prevData;

      const calculateDistance = (lat1, lng1, lat2, lng2) => {
        const R = 6371; // Earth's radius in kilometers
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Distance in kilometers
      };

      const userLat = effectiveLocation.latitude;
      const userLng = effectiveLocation.longitude;

      let hasChanges = false;
      const updatedRestaurants = prevData.map((restaurant) => {
        if (!restaurant.location) return restaurant;

        const restaurantLat =
          restaurant.location?.latitude ||
          (restaurant.location?.coordinates &&
            Array.isArray(restaurant.location.coordinates)
            ? restaurant.location.coordinates[1]
            : null);
        const restaurantLng =
          restaurant.location?.longitude ||
          (restaurant.location?.coordinates &&
            Array.isArray(restaurant.location.coordinates)
            ? restaurant.location.coordinates[0]
            : null);

        if (
          !restaurantLat ||
          !restaurantLng ||
          isNaN(restaurantLat) ||
          isNaN(restaurantLng)
        ) {
          return restaurant;
        }

        const distanceInKm = calculateDistance(
          userLat,
          userLng,
          restaurantLat,
          restaurantLng,
        );
        let calculatedDistance = null;

        // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
        if (distanceInKm >= 1) {
          calculatedDistance = `${distanceInKm.toFixed(1)} km`;
        } else {
          const distanceInMeters = Math.round(distanceInKm * 1000);
          calculatedDistance = `${distanceInMeters} m`;
        }

        if (
          restaurant.distance !== calculatedDistance ||
          restaurant.distanceInKm !== distanceInKm
        ) {
          hasChanges = true;
          return {
            ...restaurant,
            distance: calculatedDistance,
            distanceInKm: distanceInKm, // Preserve numeric distance for sorting
          };
        }
        return restaurant;
      });

      return hasChanges ? updatedRestaurants : prevData;
    });

    debugLog(
      "?? Recalculated distances for all restaurants based on user location",
    );
  }, [effectiveLocation?.latitude, effectiveLocation?.longitude]);

  // IMPORTANT:
  // Homepage should avoid eager N+1 menu requests. We only resolve menu metadata
  // when the UI truly needs it: Veg Mode is enabled, or admin categories are unavailable.
  useEffect(() => {
    const restaurantIds = menuUnionRestaurantIdsKey
      ? menuUnionRestaurantIdsKey.split(",").filter(Boolean)
      : [];
    const shouldFetchMenuMeta = vegMode || realCategories.length === 0;

    const fetchMenuCategories = async () => {
      const requestSeq = ++menuUnionRequestSeqRef.current;

      if (!menuUnionRestaurantIdsKey || !shouldFetchMenuMeta) {
        setMenuCategories([]);
        setRestaurantDietMeta({});
        setLoadingMenuCategories(false);
        return;
      }

      setLoadingMenuCategories(true);
      try {
        const categoryMap = new Map();
        const menuCache = menuUnionCacheRef.current;
        const menuResponses = [];

        for (let index = 0; index < restaurantIds.length; index += 4) {
          const batchIds = restaurantIds.slice(index, index + 4);
          const batchResponses = await Promise.all(
            batchIds.map(async (id) => {
              if (!id) return { id: null, menu: null };

              if (menuCache.has(id)) {
                return { id, menu: menuCache.get(id) };
              }

              try {
                const response = await restaurantAPI.getMenuByRestaurantId(id);
                const menu = response?.data?.data?.menu || null;
                menuCache.set(id, menu);
                return { id, menu };
              } catch {
                menuCache.set(id, null);
                return { id, menu: null };
              }
            }),
          );

          if (requestSeq !== menuUnionRequestSeqRef.current) return;
          menuResponses.push(...batchResponses);
        }

        if (requestSeq !== menuUnionRequestSeqRef.current) return;

        const nextDietMeta = {};

        menuResponses.forEach(({ id, menu }) => {
          let hasVeg = false;
          let hasNonVeg = false;
          const sections = Array.isArray(menu?.sections) ? menu.sections : [];
          sections.forEach((section) => {
            const sectionItems = Array.isArray(section?.items)
              ? section.items
              : [];
            sectionItems.forEach((item) => {
              const foodType = String(item?.foodType || "")
                .trim()
                .toLowerCase();
              if (foodType === "veg") hasVeg = true;
              if (
                foodType === "non-veg" ||
                foodType === "non veg" ||
                foodType === "nonveg"
              )
                hasNonVeg = true;
            });

            const subsections = Array.isArray(section?.subsections)
              ? section.subsections
              : [];
            subsections.forEach((subsection) => {
              const subsectionItems = Array.isArray(subsection?.items)
                ? subsection.items
                : [];
              subsectionItems.forEach((item) => {
                const foodType = String(item?.foodType || "")
                  .trim()
                  .toLowerCase();
                if (foodType === "veg") hasVeg = true;
                if (
                  foodType === "non-veg" ||
                  foodType === "non veg" ||
                  foodType === "nonveg"
                )
                  hasNonVeg = true;
              });
            });

            const categoryName = String(section?.name || "").trim();
            if (!categoryName) return;

            const slug = slugifyCategory(categoryName);
            if (!slug) return;

            let image = "";
            if (Array.isArray(section?.items) && section.items.length > 0) {
              image = normalizeImageUrl(section.items[0]?.image);
            }
            if (!image && Array.isArray(section?.subsections)) {
              for (const subsection of section.subsections) {
                if (
                  Array.isArray(subsection?.items) &&
                  subsection.items.length > 0
                ) {
                  image = normalizeImageUrl(subsection.items[0]?.image);
                  if (image) break;
                }
              }
            }

            if (!categoryMap.has(slug)) {
              categoryMap.set(slug, {
                id: slug,
                name: categoryName,
                slug,
                label: categoryName,
                image: image || "",
              });
            } else if (image && !categoryMap.get(slug).image) {
              categoryMap.get(slug).image = image;
            }
          });

          if (id) {
            nextDietMeta[id] = {
              hasVeg,
              hasNonVeg,
              isPureVeg: hasVeg && !hasNonVeg,
            };
          }
        });

        const categories = Array.from(categoryMap.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((category, index) => ({
            ...category,
            image:
              category.image ||
              foodImages[index % foodImages.length] ||
              foodImages[0],
          }));

        setMenuCategories(categories);
        setRestaurantDietMeta(nextDietMeta);
      } finally {
        if (requestSeq === menuUnionRequestSeqRef.current) {
          setLoadingMenuCategories(false);
        }
      }
    };

    fetchMenuCategories();
  }, [
    menuUnionRestaurantIdsKey,
    normalizeImageUrl,
    realCategories.length,
    slugifyCategory,
    vegMode,
  ]);

  const matchesVegMode = useCallback(
    (restaurant) => {
      if (!vegMode) return true;
      return restaurant?.pureVegRestaurant === true;
    },
    [vegMode],
  );

  // Filter restaurants and foods based on active filters
  const filteredRestaurants = useMemo(() => {
    // Rely on API data which is already filtered and sorted by the backend.
    // We only apply client-side Veg Mode filtering here.
    return (restaurantsData || []).filter(matchesVegMode);
  }, [restaurantsData, matchesVegMode]);

  const restaurantLazyLoadResetKey = useMemo(() => {
    const activeFilterKey = Array.from(activeFilters).sort().join("|");
    return `${restaurantsData.length}:${activeFilterKey}:${selectedCuisine || ""}:${sortBy || ""}:${vegMode ? "1" : "0"}`;
  }, [activeFilters, restaurantsData.length, selectedCuisine, sortBy, vegMode]);

  const visibleRestaurants = useMemo(
    () => filteredRestaurants.slice(0, visibleRestaurantCount),
    [filteredRestaurants, visibleRestaurantCount],
  );

  const hasMoreRestaurants =
    visibleRestaurantCount < filteredRestaurants.length;

  const loadMoreRestaurants = useCallback(() => {
    setVisibleRestaurantCount((previous) =>
      Math.min(previous + RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [filteredRestaurants.length, RESTAURANTS_BATCH_SIZE]);

  useEffect(() => {
    setVisibleRestaurantCount(
      Math.min(RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [restaurantLazyLoadResetKey, filteredRestaurants.length, RESTAURANTS_BATCH_SIZE]);

  useEffect(() => {
    if (visibleRestaurantCount <= filteredRestaurants.length) return;
    setVisibleRestaurantCount(filteredRestaurants.length);
  }, [filteredRestaurants.length, visibleRestaurantCount]);

  useEffect(() => {
    if (!hasMoreRestaurants) return;
    if (showRestaurantSkeleton || loadingRestaurants || isLoadingFilterResults) return;
    const target = restaurantLoadMoreRef.current;
    if (!target || typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        startTransition(() => {
          loadMoreRestaurants();
        });
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    hasMoreRestaurants,
    showRestaurantSkeleton,
    loadingRestaurants,
    isLoadingFilterResults,
    loadMoreRestaurants,
  ]);

  const recommendedForYouRestaurants = useMemo(() => {
    const idsInOrder = (recommendedRestaurantIds || []).map((id) => String(id));
    const hasIds = idsInOrder.length > 0;
    const fromSettings = Array.isArray(recommendedRestaurantsFromSettings)
      ? recommendedRestaurantsFromSettings
      : [];

    // Primary source: restaurants returned by landing settings API (already admin-selected).
    const fromSettingsMapped = fromSettings.map((restaurant) => {
      const restaurantId = restaurant?._id ? String(restaurant._id) : "";
      const cuisine =
        Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
          ? restaurant.cuisines[0]
          : "Multi-cuisine";
      const imageCandidates = extractImages([
        ...(Array.isArray(restaurant?.coverImages)
          ? restaurant.coverImages
          : [restaurant?.coverImages]
        ).filter(Boolean),
        restaurant?.profileImage,
      ]);
      const image = imageCandidates[0] || foodImages[0];

      return {
        id: restaurant?.restaurantId || restaurantId,
        mongoId: restaurantId,
        name: getRestaurantDisplayName(restaurant),
        cuisine,
        rating: Number(restaurant?.rating) || 0,
        distance: "",
        deliveryTime: "",
        image: normalizeImageUrl(image) || foodImages[0],
        images: imageCandidates.length > 0 ? imageCandidates : [foodImages[0]],
        slug: restaurant?.slug || restaurant?.restaurantId || restaurantId,
        offer: null,
        pureVegRestaurant: restaurant?.pureVegRestaurant === true,
        isActive: true,
        isAcceptingOrders: true,
      };
    });

    // Keep admin-selected order when IDs exist.
    const orderedFromSettings = hasIds
      ? idsInOrder
        .map((id) =>
          fromSettingsMapped.find(
            (restaurant) => String(restaurant.mongoId) === id,
          ),
        )
        .filter(Boolean)
      : fromSettingsMapped;

    // Fallback: if settings payload misses some entries, recover them from fetched restaurant list by ID.
    const existingIds = new Set(
      orderedFromSettings.map((restaurant) =>
        String(restaurant.mongoId || restaurant.id),
      ),
    );
    const fromFetchedMissing = (restaurantsData || []).filter((restaurant) => {
      const mongoId = String(restaurant.mongoId || "");
      return (
        hasIds && idsInOrder.includes(mongoId) && !existingIds.has(mongoId)
      );
    });

    return [...orderedFromSettings, ...fromFetchedMissing]
      .filter(matchesVegMode)
      .slice(0, 12);
  }, [
    recommendedRestaurantIds,
    recommendedRestaurantsFromSettings,
    restaurantsData,
    extractImages,
    normalizeImageUrl,
    matchesVegMode,
  ]);

  // Featured foods removed - will be handled by restaurants data from API
  const filteredFeaturedFoods = useMemo(() => {
    // Return empty array - featured foods will come from API if needed
    return [];
  }, [activeFilters, sortBy]);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleLocationClick = useCallback(() => {
    openLocationSelector();
  }, [openLocationSelector]);

  const handleSearchFocus = useCallback(() => {
    navigate("/food/user/search");
  }, [navigate]);

  const handleSearchClose = useCallback(() => {
    closeSearch();
    setHeroSearch("");
  }, [closeSearch]);

  // Removed GSAP animations - using CSS and ScrollReveal components instead for better performance
  // Auto-scroll removed - manual scroll only

  // Animated placeholder cycling - same as RestaurantDetails highlight offer animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 2000); // Change placeholder every 2 seconds (same as RestaurantDetails)

    return () => clearInterval(interval);
  }, []); // placeholders is a constant, no need for dependency

  // Memoized Hero Banner Component for better perf
  const HeroBannerSection = useMemo(() => {
    if (showBannerSkeleton) {
      return (
        <div className="px-4 py-2">
          <HeroBannerSkeleton className="h-28 sm:h-36 lg:h-44 rounded-2xl" />
        </div>
      );
    }

    if (heroBannerImages.length === 0) return null;

    return (
      <div className="px-4 py-2">
        <div
          ref={heroShellRef}
          data-home-hero-shell="true"
          className="relative w-full overflow-hidden aspect-[1.85/1] rounded-2xl shadow-sm group cursor-pointer bg-white"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="absolute inset-0 z-0">
            {/* Shining Glint Effect */}
            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
              <motion.div
                animate={{
                  x: ['-200%', '200%'],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  repeatDelay: 5,
                  ease: "easeInOut"
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-20deg] w-[150%] h-full"
              />
            </div>
            {heroBannerImages.map((image, index) => (
              <div
                key={`${index}-${image}`}
                className="absolute inset-0 transition-opacity duration-700 ease-in-out"
                style={{
                  opacity: currentBannerIndex === index ? 1 : 0,
                  zIndex: currentBannerIndex === index ? 2 : 1,
                  pointerEvents: "none",
                }}>
                {isVideoBannerUrl(image) ? (
                  // A hero banner may be a video, not just an image. Muted and
                  // playsInline are what let it autoplay at all -- browsers block
                  // autoplay with sound, and iOS otherwise takes the video
                  // fullscreen instead of leaving it inline in the carousel.
                  <video
                    src={image}
                    autoPlay
                    loop
                    muted
                    playsInline
                    // Only the visible slide is worth fetching; the rest load
                    // their first frame so a swipe is not a blank panel.
                    preload={index === currentBannerIndex ? "auto" : "metadata"}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <img
                    src={image}
                    alt={`Hero Banner ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading={index === currentBannerIndex ? "eager" : "lazy"}
                    fetchPriority={index === currentBannerIndex ? "high" : "low"}
                    draggable={false}
                  />
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            className="absolute inset-0 z-20 h-full w-full border-0 p-0 bg-transparent text-left"
            onClick={() => {
              const bannerData = heroBannersData[currentBannerIndex];
              const linkedRestaurants = bannerData?.linkedRestaurants || [];
              if (linkedRestaurants.length > 0) {
                const firstRestaurant = linkedRestaurants[0];
                const restaurantSlug = firstRestaurant.slug || firstRestaurant.restaurantId || firstRestaurant._id;
                navigate(`/restaurants/${restaurantSlug}`);
              }
            }}
            aria-label={`Open hero banner ${currentBannerIndex + 1}`}
          />

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-1.5 bg-black/20 backdrop-blur-md rounded-full border border-white/10 z-30">
            {heroBannerImages.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentBannerIndex(index);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${currentBannerIndex === index ? "bg-white w-5" : "bg-white/40 w-1.5"
                  }`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }, [heroBannerImages, currentBannerIndex, showBannerSkeleton, heroBannersData, navigate]);

  // Memoized Category Rail Header
  const CategoryRailHeader = useMemo(() => {
    return (
      <section className="space-y-4 pt-4 sm:pt-6">
        <div className="px-4 flex items-center justify-between">
          <h2 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            What's on your mind today?
          </h2>
          <Link
            to="/food/user/categories"
            className="flex items-center gap-1.5 text-xs sm:text-sm font-extrabold text-red-600 dark:text-red-500 hover:text-red-700 transition-colors">
            View All
            <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </Link>
        </div>
      </section>
    );
  }, []);

  // Memoized Category Rail Component
  const CategoryRailSection = useMemo(() => {
    return (
      <div
        ref={categoryScrollRef}
        className="flex gap-4 sm:gap-6 lg:gap-8 overflow-x-auto overflow-y-visible scrollbar-hide scroll-smooth px-4 py-3 select-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {showCategorySkeleton ? (
          <CategoryChipRowSkeleton className="py-1" />
        ) : (
          displayCategories.slice(0, 12).map((category, index) => (
            <Link
              key={category.id || index}
              to={`/food/user/category/${category.slug || category.name.toLowerCase().replace(/\s+/g, "-")}`}
              className="flex-shrink-0 flex flex-col items-center gap-2.5 group transition-all duration-300 hover:-translate-y-1.5"
              style={{ animation: `fade-in-up 0.5s ease-out forwards ${index * 0.05}s`, opacity: 0 }}
            >
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-white dark:bg-[#1a1a1a] transition-all duration-300">
                <OptimizedImage
                  src={category.image}
                  alt={category.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  sizes="96px"
                />
              </div>
              <span className="text-xs sm:text-sm font-extrabold text-gray-800 dark:text-gray-100 text-center truncate max-w-[80px] group-hover:text-[#ff6d00] transition-colors">
                {category.name}
              </span>
            </Link>
          ))
        )}

        {!showCategorySkeleton && (isCategoryStuck || displayCategories.length > 12) && (
          <div
            className="flex-shrink-0 flex flex-col items-center gap-2.5 cursor-pointer group"
            onClick={() => navigate("/food/user/categories")}
          >
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#ff6d00]/5 dark:bg-[#ff6d00]/10 flex items-center justify-center border border-[#ff6d00]/15 group-hover:border-[#ff6d00] group-hover:shadow-lg transition-all duration-300">
              <Plus className="w-7 h-7 text-[#ff6d00]" />
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-gray-800 dark:text-gray-100">See All</span>
          </div>
        )}
      </div>
      // NEW UI END
    );
  }, [displayCategories, showCategorySkeleton, navigate, isCategoryStuck]);

  return (

    <div className="relative min-h-screen bg-white dark:bg-[#0a0a0a] pb-20 md:pb-6 overflow-x-clip">
      <div className="transition-all duration-300">
        {/* Unified Background for Entire Page - Vibrant Food Theme */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none overflow-hidden z-0">
          {/* Main Background */}
          <div className="absolute inset-0 bg-white dark:bg-[#0a0a0a]"></div>
          {/* Background Elements - Reduced to 2 blobs with CSS animations for better performance */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {/* Top right blob - CSS animation */}
            <div
              style={{
                animation: "blob 8s ease-in-out infinite",
                willChange: "transform",
              }}
            />
            {/* Bottom left blob - CSS animation */}
            <div
              style={{
                animation: "blob-reverse 10s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>
          {/* CSS keyframes for animations */}
          <style>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(50px, -30px) scale(1.2);
            }
          }
          @keyframes blob-reverse {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(-40px, 40px) scale(1.3);
            }
          }
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes gradient {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes wiggle {
            0%, 100% {
              transform: rotate(0deg);
            }
            25% {
              transform: rotate(10deg);
            }
            75% {
              transform: rotate(-10deg);
            }
          }
          @keyframes placeholderFade {
            0% {
              opacity: 0;
              transform: translateY(20px);
            }
            100% {
              opacity: 0.6;
              transform: translateY(0);
            }
          }
          @keyframes gradientShift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes slideUp {
            0% {
              opacity: 0;
              transform: translateY(15px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
        </div>

        <div className="relative z-10">
          <HomeHeader
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            location={effectiveLocation}
            savedAddressText={headerSavedAddressText}
            handleLocationClick={handleLocationClick}
            handleSearchFocus={handleSearchFocus}
            placeholderIndex={placeholderIndex}
            placeholders={placeholders}
            handleVegModeChange={handleVegModeChange}
            isVegMode={vegMode}
            vegModeToggleRef={vegModeToggleRef}
            isCategoryStuck={isCategoryStuck}
          />

          {/* Search bar is now integrated inside HomeHeader to remain inside the orange container */}

          <PromoRow
            handleVegModeChange={handleVegModeChange}
            navigate={navigate}
            isVegMode={vegMode}
            toggleRef={vegModeToggleRef}
          />

          <StaticPromoBanners banners={heroBannersData} />

          <PromotionBannerCarousel zoneId={zoneId} />

        {/* NEW UI START */}
        <div className="sticky top-[68px] z-[60] bg-white dark:bg-[#0a0a0a] border-b border-gray-100/60 dark:border-gray-900/50 shadow-[0_4px_16px_rgba(0,0,0,0.04)] pb-2 transition-all duration-300">
          {CategoryRailHeader}
          {CategoryRailSection}
        </div>
        {/* NEW UI END */}



          {/* Horizontal Filters Row */}
          {/* OLD UI COMMENTED OUT — preserved for rollback
        <div className="px-4 py-3 flex items-center gap-2 overflow-x-auto scrollbar-hide select-none bg-white dark:bg-[#0a0a0a] border-b border-gray-100 dark:border-gray-900">
          <button
            onClick={() => setIsFilterOpen(true)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.size > 0 || sortBy || selectedCuisine
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Filters</span>
            {activeFilters.size > 0 && (
              <span className="ml-1 bg-[#EB590E] text-white text-[9px] h-4 w-4 rounded-full flex items-center justify-center font-bold">
                {activeFilters.size}
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("rating-4-plus")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("rating-4-plus")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${activeFilters.has("rating-4-plus") ? "fill-[#EB590E] text-[#EB590E]" : "text-gray-400"}`} />
            <span>Rating 4.0+</span>
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("rating-35-plus")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("rating-35-plus")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${activeFilters.has("rating-35-plus") ? "fill-[#EB590E] text-[#EB590E]" : "text-gray-400"}`} />
            <span>Rating 3.5+</span>
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("pricing-no-packaging")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("pricing-no-packaging")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <span>No packaging charges</span>
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("pricing-same-price")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("pricing-same-price")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <span>Same price as restaurant</span>
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("price-under-200")}
            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("price-under-200")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <IndianRupee className="h-3.5 w-3.5" />
            <span>Under 200</span>
          </button>

          <button
            onClick={() => handleToggleHorizontalFilter("distance-under-2km")}
            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${
              activeFilters.has("distance-under-2km")
                ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            <span>Nearby (&lt; 2 km)</span>
          </button>
        </div>
        */}

          {/* NEW UI START */}
          <div className="px-4 py-3 flex items-center gap-2 overflow-x-auto scrollbar-hide select-none bg-white dark:bg-[#0a0a0a] border-b border-gray-100 dark:border-gray-900 pointer-events-auto">
            {/* Sort Pill */}
            <button
              onClick={() => {
                setActiveFilterTab("sort");
                setIsFilterOpen(true);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${sortBy
                  ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-red-500 text-red-600 shadow-sm"
                  : "bg-red-50/50 dark:bg-[#1a1a1a] border-red-200 dark:border-red-800 text-red-600 dark:text-red-500 hover:border-red-300 dark:hover:border-red-700"
                }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-red-500" />
              <span>Sort {sortBy ? `(${sortBy})` : ''}</span>
              <ChevronDown className="h-3 w-3 text-red-500 opacity-60" />
            </button>

            {/* Rating 4+ Pill */}
            <button
              onClick={() => handleToggleHorizontalFilter("rating-4-plus")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${activeFilters.has("rating-4-plus")
                  ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-red-500 text-red-600 shadow-sm"
                  : "bg-red-50/50 dark:bg-[#1a1a1a] border-red-200 dark:border-red-800 text-red-600 dark:text-red-500 hover:border-red-300 dark:hover:border-red-700"
                }`}
            >
              <Star className={`h-3.5 w-3.5 ${activeFilters.has("rating-4-plus") ? "fill-red-500 text-red-500" : "text-red-500"}`} />
              <span>Rating 4.0+</span>
            </button>

            {/* Fast Delivery Pill */}
            <button
              onClick={() => handleToggleHorizontalFilter("delivery-under-30")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${activeFilters.has("delivery-under-30")
                  ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-red-500 text-red-600 shadow-sm"
                  : "bg-red-50/50 dark:bg-[#1a1a1a] border-red-200 dark:border-red-800 text-red-600 dark:text-red-500 hover:border-red-300 dark:hover:border-red-700"
                }`}
            >
              <Clock className="h-3.5 w-3.5 text-red-500" />
              <span>Fast Delivery</span>
            </button>

            {/* Pure Veg Pill */}
            <button
              onClick={() => handleVegModeChange(!vegMode)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${vegMode
                  ? "bg-green-50 dark:bg-green-950/20 border-green-500 text-green-600 shadow-sm"
                  : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-755 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-green-600 flex items-center justify-center p-[2px] border border-white dark:border-black flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-white" />
              </span>
              <span>Pure Veg</span>
            </button>

            {/* Offers Pill */}
            <button
              onClick={() => handleToggleHorizontalFilter("has-offers")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${activeFilters.has("has-offers")
                  ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                  : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-755 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>Offers</span>
            </button>

            {/* Under ₹200 Pill */}
            <button
              onClick={() => handleToggleHorizontalFilter("price-under-200")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-xs font-bold transition-all duration-300 hover:scale-105 active:scale-95 flex-shrink-0 ${activeFilters.has("price-under-200")
                  ? "bg-[#FFF2EB] dark:bg-orange-950/20 border-[#EB590E] text-[#EB590E] shadow-sm"
                  : "bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 text-gray-755 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700"
                }`}
            >
              <IndianRupee className="h-3.5 w-3.5" />
              <span>Under ₹200</span>
            </button>
          </div>
          {/* NEW UI END */}

          {/* Previously Ordered Section */}
          {/* OLD UI COMMENTED OUT — preserved for rollback
        {!loadingPreviouslyOrdered && previouslyOrderedRestaurants.length > 0 && (
          <div className="px-4 py-4 sm:py-6">
            <HorizontalCarousel
              header={
                <h2 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                  Previously ordered
                </h2>
              }
              showControls={true}
            >
              {previouslyOrderedRestaurants.map((restaurant) => (
                <Link
                  key={`prev-ordered-${restaurant.mongoId || restaurant.id}`}
                  to={`/user/restaurants/${restaurant.slug}`}
                  className="w-48 sm:w-56 flex-shrink-0 flex flex-col bg-white dark:bg-[#1a1a1a] rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1 group"
                >
                  <div className="relative h-28 sm:h-32 bg-gray-50 overflow-hidden">
                    <RestaurantImageCarousel
                      restaurant={restaurant}
                      backendOrigin={BACKEND_ORIGIN}
                      className="h-28 sm:h-32"
                      roundedClass="rounded-t-2xl"
                    />
                  </div>
                  <div className="p-3 flex flex-col flex-grow">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate group-hover:text-[#ff6d00] transition-colors">
                      {restaurant.name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold text-white px-1.5 py-0.5 rounded-md ${restaurant.rating > 0 ? "bg-[#259539]" : "bg-gray-400"}`}>
                        {restaurant.rating > 0 ? restaurant.rating.toFixed(1) : "NEW"}
                        {restaurant.rating > 0 && <Star className="h-2.5 w-2.5 fill-white text-white" strokeWidth={0} />}
                      </span>
                      <span className="text-[10px] text-gray-400">•</span>
                      <span className="text-[10px] text-gray-500 truncate max-w-[80px]">
                        {restaurant.cuisine}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-gray-500">
                      <Clock className="h-3.5 w-3.5 text-gray-400" />
                      <span>{restaurant.deliveryTime}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </HorizontalCarousel>
          </div>
        )}
        */}

          {/* NEW UI START */}
          {!loadingPreviouslyOrdered && previouslyOrderedRestaurants.length > 0 && (
            <div className="px-4 py-4 sm:py-6">
              <HorizontalCarousel
                header={
                  <div className="flex flex-col gap-0.5 mb-2">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                      Order again
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
                      Your favourites, just one tap away
                    </p>
                  </div>
                }
                showControls={true}
              >
                {previouslyOrderedRestaurants.map((restaurant) => (
                  <div
                    key={`prev-ordered-${restaurant.mongoId || restaurant.id}`}
                    className="w-48 sm:w-56 flex-shrink-0 flex flex-col bg-white dark:bg-[#1a1a1a] rounded-[24px] overflow-hidden border border-gray-150/70 dark:border-gray-800/80 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-2 group active:scale-[0.97]"
                  >
                    <Link to={`/user/restaurants/${restaurant.slug}`} className="block relative h-28 sm:h-32 bg-gray-50 overflow-hidden">
                      <RestaurantImageCarousel
                        restaurant={restaurant}
                        backendOrigin={BACKEND_ORIGIN}
                        className="h-28 sm:h-32"
                        roundedClass="rounded-t-[24px]"
                      />
                    </Link>
                    <div className="p-3.5 flex flex-col flex-grow">
                      <Link to={`/user/restaurants/${restaurant.slug}`} className="block">
                        <h3 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white truncate group-hover:text-[#ff6d00] transition-colors leading-tight">
                          {restaurant.name}
                        </h3>
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-black text-white px-2 py-0.5 rounded-lg ${restaurant.rating > 0 ? "bg-[#259539]" : "bg-gray-400"}`}>
                          {restaurant.rating > 0 ? restaurant.rating.toFixed(1) : "NEW"}
                          {restaurant.rating > 0 && <Star className="h-2.5 w-2.5 fill-white text-white" strokeWidth={0} />}
                        </span>
                        <span className="text-[10px] text-gray-400 font-bold">•</span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 font-bold truncate max-w-[80px]">
                          {restaurant.cuisine}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400 font-bold">
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                          <span>{restaurant.deliveryTime}</span>
                        </div>

                        {/* UI-only reorder button — existing reorder logic not available */}
                        <Link
                          to={`/user/restaurants/${restaurant.slug}`}
                          className="px-3 py-1 bg-[#ff6d00] hover:bg-[#d90262] text-white text-[10px] font-black rounded-lg transition-colors shadow-sm cursor-pointer active:scale-95"
                        >
                          Reorder
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </HorizontalCarousel>
            </div>
          )}
          {/* NEW UI END */}


          {recommendedForYouRestaurants.length > 0 && (
            <motion.section
              className="content-auto space-y-4 pt-4 sm:pt-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}>
              <div className="px-4 flex items-center justify-between">
                <h2 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                  Recommended for you
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 px-4 pb-2">
                {recommendedForYouRestaurants.map((restaurant, index) => {
                  const restaurantSlug =
                    restaurant.slug ||
                    restaurant.name.toLowerCase().replace(/\s+/g, "-");
                  return (
                    <motion.div
                      key={`recommended-${restaurant.mongoId || restaurant.id || restaurantSlug}`}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.35, delay: index * 0.05 }}
                      whileTap={{ scale: 0.96 }}>
                      <Link
                        to={`/user/restaurants/${restaurantSlug}`}
                        className="block rounded-[20px] overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-sm hover:shadow-md transition-shadow">
                        <div className="relative h-24 sm:h-28 md:h-32 bg-gray-50">
                          <RestaurantImageCarousel
                            restaurant={restaurant}
                            backendOrigin={BACKEND_ORIGIN}
                            className="h-24 sm:h-28 md:h-32"
                            roundedClass="rounded-t-[20px]"
                          />
                          <div className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-lg ${Number(restaurant.rating) > 0 ? "bg-black/80 backdrop-blur-md text-white font-medium" : "bg-gray-200/90 text-gray-600 font-medium"} text-[10px] shadow-lg border border-white/10`}>
                            {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                          </div>
                        </div>
                        <div className="p-2.5">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate tracking-tight">
                            {restaurant.name}
                          </p>
                          <p className="text-[10px] text-accent-orange font-bold mt-1 flex items-center gap-1 uppercase tracking-wider">
                            <Flame className="w-3.5 h-3.5 fill-orange-600" />
                            Near & Fast
                          </p>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </motion.section>
          )}



          {/* Restaurants - Enhanced with Animations */}
          <motion.section
            className="content-auto space-y-0 pt-3 sm:pt-4 lg:pt-6 pb-8 md:pb-10"
            initial={false}
            animate={{ opacity: 1 }}>
            <div className="px-4 mb-3 lg:mb-4">
              <div className="flex flex-col gap-0.5 lg:gap-1">
                <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-gray-400 tracking-widest uppercase">
                  {filteredRestaurants.length} Restaurants Delivering to You
                </h2>
                <span className="text-base sm:text-lg lg:text-2xl text-gray-500 font-normal">
                  Featured
                </span>
              </div>
            </div>
            <div
              className={`relative ${showRestaurantSkeleton ? "min-h-[360px] sm:min-h-[420px]" : ""}`}>
              {/* Loading Overlay */}
              <AnimatePresence>
                {showRestaurantSkeleton && (
                  <motion.div
                    className="absolute inset-0 z-10 rounded-lg bg-white/94 dark:bg-[#1a1a1a]/94"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}>
                    <LoadingSkeletonRegion label="Loading restaurants" className="h-full p-1 sm:p-2">
                      <RestaurantGridSkeleton
                        count={3}
                        className="grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
                        compact
                      />
                    </LoadingSkeletonRegion>
                  </motion.div>
                )}
              </AnimatePresence>
              <div
                className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-4 lg:gap-5 xl:gap-6 px-4 pt-1 sm:pt-1.5 lg:pt-2 items-stretch ${isLoadingFilterResults || loadingRestaurants ? "opacity-50" : "opacity-100"} transition-opacity duration-300`}>
                {visibleRestaurants.map((restaurant, index) => {
                  const nameStr =
                    typeof restaurant?.name === "string"
                      ? restaurant.name.trim()
                      : "";
                  const fallbackSlugSource =
                    nameStr ||
                    (typeof restaurant?.restaurantName === "string"
                      ? restaurant.restaurantName.trim()
                      : "") ||
                    String(
                      restaurant?.slug ||
                      restaurant?.id ||
                      restaurant?._id ||
                      `restaurant-${index}`,
                    );

                  const restaurantSlug =
                    typeof restaurant?.slug === "string" &&
                      restaurant.slug.trim()
                      ? restaurant.slug.trim()
                      : fallbackSlugSource.toLowerCase().replace(/\s+/g, "-");
                  const availability = getRestaurantAvailabilityStatus(
                    restaurant,
                    new Date(availabilityTick),
                    { ignoreOperationalStatus: true },
                  );
                  // Direct favorite check - isFavorite is already memoized in context
                  const favorite = isFavorite(restaurantSlug);

                  const handleToggleFavorite = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (favorite) {
                      // If already bookmarked, show Manage Collections modal
                      setSelectedRestaurantSlug(restaurantSlug);
                      setShowManageCollections(true);
                    } else {
                      // Add to favorites and show toast
                      addFavorite({
                        slug: restaurantSlug,
                        name: restaurant.name,
                        cuisine: restaurant.cuisine,
                        rating: restaurant.rating,
                        deliveryTime: restaurant.deliveryTime,
                        distance: restaurant.distance,
                        priceRange: restaurant.priceRange,
                        image: restaurant.image,
                      });
                      setShowToast(true);
                      setTimeout(() => {
                        setShowToast(false);
                      }, 3000);
                    }
                  };

                  return (
                    <div
                      key={
                        restaurant?.id ||
                        restaurant?._id ||
                        restaurantSlug ||
                        index
                      }
                      className="h-full transform transition-all duration-300 hover:-translate-y-3 hover:scale-[1.02] active:scale-[0.97]"
                      style={{
                        perspective: 1000,
                        animation:
                          index < 10
                            ? `fade-in-up 0.5s ease-out ${index * 0.05}s backwards`
                            : "none",
                      }}>
                      <div className="h-full group">
                        <Link
                          to={`/user/restaurants/${restaurantSlug}`}
                          className="h-full flex">
                          {/* OLD UI COMMENTED OUT — preserved for rollback
                          <Card
                            className={`overflow-hidden gap-0 cursor-pointer border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] border-background transition-all duration-500 py-0 rounded-[28px] flex flex-col h-full w-full relative shadow-sm hover:shadow-xl ${
                              isOutOfService || !availability.isOpen
                                ? "grayscale opacity-75"
                                : ""
                            }`}>
                            <div className="relative">
                              <RecommendedFoodImageStrip
                                restaurant={restaurant}
                                priority={index < 3}
                                backendOrigin={BACKEND_ORIGIN}
                              />

                              <div className="absolute top-4 left-4 flex items-center z-10 transform transition-transform duration-300 group-hover:scale-105">
                                <div className="bg-black/70 backdrop-blur-lg text-white px-4 py-1.5 rounded-full text-[11px] font-medium tracking-tight flex items-center shadow-2xl border border-white/20">
                                  {restaurant.featuredDish} @ Rs {restaurant.featuredPrice}
                                </div>
                              </div>

                              <div className="absolute top-4 right-4 z-10 transform transition-transform duration-300 group-hover:scale-110">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleToggleFavorite}
                                  aria-label={
                                    favorite
                                      ? "Remove from favorites"
                                      : "Add to favorites"
                                  }
                                  className={`h-11 w-11 rounded-[20px] shadow-xl flex items-center justify-center transition-all duration-300 ${
                                    favorite
                                      ? "bg-red-500 text-white"
                                      : "bg-white/90 backdrop-blur-sm text-gray-800 hover:bg-white"
                                  }`}>
                                  <Bookmark
                                    className={`h-5 w-5 transition-all duration-300 ${
                                      favorite ? "fill-white" : ""
                                    }`}
                                  />
                                </Button>
                              </div>
                            </div>

                            <div className="transform transition-transform duration-300 group-hover:-translate-y-1">
                              <CardContent className="p-3 sm:p-4 lg:p-5 pt-3 sm:pt-4 lg:pt-5 flex flex-col flex-grow">
                                <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-lg lg:text-2xl font-medium text-gray-950 dark:text-white line-clamp-1 leading-tight tracking-tight transition-colors duration-300 group-hover:text-[#ff6d00]">
                                      {restaurant.name}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                      <span
                                        className={`inline-flex rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-widest shadow-sm ${availability.isOpen ? "bg-emerald-500 text-white" : "bg-gray-400 text-white"}`}>
                                        {availability.isOpen
                                          ? "Open now"
                                          : "Offline"}
                                      </span>
                                      {availability.isOpen &&
                                        availability.closingCountdownLabel &&
                                        availability.openingTime &&
                                        availability.closingTime && (
                                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-medium uppercase tracking-wide">
                                            <Timer
                                              className="h-3 w-3 flex-shrink-0"
                                              strokeWidth={2.5}
                                            />
                                            <span>
                                              {availability.closingCountdownLabel}
                                            </span>
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                  <div className={`flex-shrink-0 ${Number(restaurant.rating) > 0 ? "bg-[#259539]" : "bg-gray-400"} text-white px-3 py-1.5 rounded-2xl flex items-center gap-1.5 shadow-md transform transition-transform duration-300 group-hover:scale-110`}>
                                    <span className="text-sm lg:text-lg font-medium tracking-tight">
                                      {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                                    </span>
                                    {Number(restaurant.rating) > 0 && <Star className="h-3.5 w-3.5 lg:h-4.5 lg:w-4.5 fill-white text-white" strokeWidth={0} />}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 text-sm lg:text-base text-gray-500 mb-2 lg:mb-3 transition-opacity duration-300 opacity-70 group-hover:opacity-100">
                                  <Clock
                                    className="h-4 w-4 lg:h-5 lg:w-5 text-gray-500 dark:text-gray-400"
                                    strokeWidth={1.5}
                                  />
                                  <span className="font-medium dark:text-gray-300 text-gray-700">
                                    {restaurant.deliveryTime}
                                  </span>
                                  <span className="mx-1">|</span>
                                  <span className="font-medium dark:text-gray-300 text-gray-700">
                                    {restaurant.distance}
                                  </span>
                                </div>

                                {restaurant.offer && (
                                  <div className="flex items-center gap-2 text-sm lg:text-base mt-auto transform transition-transform duration-300 group-hover:translate-x-1">
                                    <BadgePercent
                                      className="h-4 w-4 lg:h-5 lg:w-5 text-black"
                                      strokeWidth={2}
                                    />
                                    <span className="text-gray-700 dark:text-gray-300 font-medium">
                                      {restaurant.offer}
                                    </span>
                                  </div>
                                )}
                              </CardContent>
                            </div>

                            <div className="absolute inset-0 rounded-md pointer-events-none z-0 transition-all duration-300 border border-transparent group-hover:border-[#EB590E]/30 group-hover:shadow-[inset_0_0_0_1px_rgba(235,89,14,0.2)]" />
                          </Card>
                          */}

                          {/* NEW UI START */}
                          <Card
                            className={`overflow-hidden gap-0 cursor-pointer border border-gray-100 dark:border-gray-805 group bg-white dark:bg-[#1a1a1a] transition-all duration-500 rounded-[24px] flex flex-col h-full w-full relative shadow-sm hover:shadow-xl hover:border-gray-200 dark:hover:border-gray-750 ${isOutOfService || !availability.isOpen
                                ? "grayscale opacity-70"
                                : ""
                              }`}>
                            {/* Image Section with Carousel */}
                            <div className="relative overflow-hidden aspect-[1.5/1]">
                              <RecommendedFoodImageStrip
                                restaurant={restaurant}
                                priority={index < 3}
                                backendOrigin={BACKEND_ORIGIN}
                                className="h-full w-full object-cover"
                              />

                              {/* Featured Dish Badge - Top Left */}
                              <div className="absolute top-3 left-3 flex items-center z-10">
                                <div className="bg-black/60 backdrop-blur-md text-white px-3.5 py-1 rounded-full text-[10px] font-black tracking-wide flex items-center shadow-lg border border-white/10">
                                  {restaurant.featuredDish} @ <span className="text-[#ff3d00] font-black ml-1">₹{restaurant.featuredPrice}</span>
                                </div>
                              </div>

                              {/* Diet Badge (Veg Indicator) */}
                              {restaurant.pureVegRestaurant && (
                                <div className="absolute bottom-3 left-3 flex items-center z-10">
                                  <div className="bg-green-600/90 backdrop-blur-sm text-white px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-md">
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                    Veg
                                  </div>
                                </div>
                              )}

                              {/* Favorite Heart - Top Right */}
                              <div className="absolute top-3 right-3 z-10">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleToggleFavorite}
                                  aria-label={
                                    favorite
                                      ? "Remove from favorites"
                                      : "Add to favorites"
                                  }
                                  className={`h-9 w-9 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 active:scale-90 ${favorite
                                      ? "bg-red-500 text-white hover:bg-red-600"
                                      : "bg-white/95 backdrop-blur-sm text-gray-800 hover:bg-white hover:scale-105"
                                    }`}>
                                  <Heart
                                    className={`h-4.5 w-4.5 transition-all duration-300 ${favorite ? "fill-white text-white" : "text-gray-600 group-hover:text-red-500"
                                      }`}
                                  />
                                </Button>
                              </div>
                            </div>

                            {/* Content Section */}
                            <CardContent className="p-4 flex flex-col flex-grow">
                              {/* Restaurant Name & Rating */}
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-base sm:text-lg font-black text-gray-900 dark:text-white line-clamp-1 leading-tight tracking-tight group-hover:text-[#ff6d00] transition-colors duration-300">
                                    {restaurant.name}
                                  </h3>
                                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <span
                                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest shadow-sm ${availability.isOpen ? "bg-emerald-500 text-white" : "bg-gray-400 text-white"}`}>
                                      {availability.isOpen
                                        ? "Open now"
                                        : "Offline"}
                                    </span>
                                    {availability.isOpen &&
                                      availability.closingCountdownLabel && (
                                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30 text-[9px] font-black uppercase tracking-wide">
                                          <Timer className="h-2.5 w-2.5 flex-shrink-0" strokeWidth={2.5} />
                                          <span>{availability.closingCountdownLabel}</span>
                                        </div>
                                      )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                  <div className={`${Number(restaurant.rating) > 0 ? "bg-[#259539]" : "bg-gray-400"} text-white px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-sm transform transition-transform duration-300 group-hover:scale-105`}>
                                    <span className="text-xs sm:text-sm font-black tracking-tight">
                                      {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                                    </span>
                                    {Number(restaurant.rating) > 0 && <Star className="h-3 w-3 fill-white text-white" strokeWidth={0} />}
                                  </div>
                                  {restaurant.totalRatings > 0 && (
                                    <span className="text-[9px] text-gray-455 dark:text-gray-400 font-bold">({restaurant.totalRatings} reviews)</span>
                                  )}
                                </div>
                              </div>

                              {/* Cuisines */}
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-2.5">
                                {restaurant.cuisines?.join(", ") || restaurant.cuisine}
                              </p>

                              {/* Delivery Time & Distance */}
                              <div className="flex items-center gap-2 text-xs text-gray-650 dark:text-gray-400 mb-3 pt-2.5 border-t border-gray-50 dark:border-gray-800/60">
                                <div className="flex items-center gap-1 font-bold">
                                  <Clock className="h-3.5 w-3.5 text-gray-400" strokeWidth={2} />
                                  <span>{restaurant.deliveryTime}</span>
                                </div>
                                <span className="text-gray-300 dark:text-gray-700">•</span>
                                <div className="flex items-center gap-1 font-bold">
                                  <MapPin className="h-3.5 w-3.5 text-red-600 dark:text-red-500" strokeWidth={2} />
                                  <span className="text-red-600 dark:text-red-500">{restaurant.distance}</span>
                                </div>
                              </div>

                              {/* Offer Badge */}
                              {restaurant.offer && (
                                <div className="flex items-center gap-1.5 text-xs mt-auto bg-[#FFF2EB] dark:bg-orange-950/10 px-2.5 py-1.5 rounded-xl border border-[#EB590E]/15">
                                  <BadgePercent
                                    className="h-3.5 w-3.5 text-[#EB590E]"
                                    strokeWidth={2.5}
                                  />
                                  <span className="text-[#EB590E] font-black truncate">
                                    {restaurant.offer}
                                  </span>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                          {/* NEW UI END */}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col items-center pt-2 sm:pt-3 gap-2 px-4">
              {hasMoreRestaurants && (
                <Button
                  variant="outline"
                  onClick={loadMoreRestaurants}
                  className="text-sm font-medium border-gray-300 hover:border-gray-400">
                  Load more restaurants
                </Button>
              )}
              <div
                ref={restaurantLoadMoreRef}
                className="h-1 w-full"
                aria-hidden="true"
              />
            </div>
          </motion.section>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      <AnimatePresence>
        {isFilterOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Modal Content */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-3xl max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 400,
                duration: 0.3,
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Filters and sorting
                </h2>
                <button
                  onClick={() => {
                    setActiveFilters(new Set());
                    setSortBy(null);
                    setSelectedCuisine(null);
                  }}
                  className="text-[#EB590E] font-medium text-sm">
                  Clear all
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Tabs */}
                <div className="w-24 sm:w-28 bg-gray-50 dark:bg-[#0a0a0a] border-r dark:border-gray-800 flex flex-col">
                  {[
                    { id: "sort", label: "Sort By", icon: ArrowDownUp },
                    { id: "time", label: "Time", icon: Timer },
                    { id: "rating", label: "Rating", icon: Star },
                    { id: "distance", label: "Distance", icon: MapPin },
                    { id: "price", label: "Dish Price", icon: IndianRupee },
                    { id: "offers", label: "Offers", icon: BadgePercent },
                    { id: "trust", label: "Trust", icon: ShieldCheck },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive =
                      activeScrollSection === tab.id ||
                      activeFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveFilterTab(tab.id);
                          const section = filterSectionRefs.current[tab.id];
                          if (section) {
                            section.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }
                        }}
                        className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive
                            ? "bg-white dark:bg-[#1a1a1a] text-[#EB590E]"
                            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#EB590E] rounded-r" />
                        )}
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium leading-tight">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Content Area - Scrollable */}
                <div
                  ref={rightContentRef}
                  className="flex-1 overflow-y-auto p-4">
                  {/* Sort By Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["sort"] = el)}
                    data-section-id="sort"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Sort by
                    </h3>
                    <div className="flex flex-col gap-3">
                      {[
                        { id: null, label: "Relevance" },
                        { id: "price-low", label: "Price: Low to High" },
                        { id: "price-high", label: "Price: High to Low" },
                        { id: "rating-high", label: "Rating: High to Low" },
                        { id: "rating-low", label: "Rating: Low to High" },
                      ].map((option) => (
                        <button
                          key={option.id || "relevance"}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 py-3 rounded-xl border text-left transition-colors ${sortBy === option.id
                              ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                              : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                            }`}>
                          <span
                            className={`text-sm font-medium ${sortBy === option.id ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["time"] = el)}
                    data-section-id="time"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Estimated Time
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("delivery-under-30")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-30")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-30") ? "text-[#EB590E]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-30") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 30 mins
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("delivery-under-45")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-45")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-45") ? "text-[#EB590E]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-45") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 45 mins
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Rating Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["rating"] = el)}
                    data-section-id="rating"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900  dark:text-white mb-4">
                      Restaurant Rating
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("rating-35-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-35-plus")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-35-plus") ? "text-[#EB590E] fill-[#EB590E]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-35-plus") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 3.5+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-4-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-4-plus")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-4-plus") ? "text-[#EB590E] fill-[#EB590E]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-4-plus") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.0+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-45-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-45-plus")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-45-plus") ? "text-[#EB590E] fill-[#EB590E]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-45-plus") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.5+
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Distance Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["distance"] = el)}
                    data-section-id="distance"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Distance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("distance-under-1km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-1km")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-1km") ? "text-[#EB590E]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-1km") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 1 km
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("distance-under-2km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-2km")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-2km") ? "text-[#EB590E]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-2km") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 2 km
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Price Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["price"] = el)}
                    data-section-id="price"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Dish Price
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("price-under-200")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-200")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-200") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under â‚¹200
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("price-under-500")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-500")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-500") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹500
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("pricing-no-packaging")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("pricing-no-packaging")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("pricing-no-packaging") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          No packaging charges
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("pricing-same-price")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("pricing-same-price")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("pricing-same-price") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Same price as restaurant
                        </span>
                      </button>
                    </div>
                  </div>



                  {/* Trust Markers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["trust"] = el)}
                    data-section-id="trust"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Trust Markers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("top-rated")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("top-rated")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("top-rated") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Top Rated
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("trusted")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("trusted")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("trusted") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Trusted by 1000+ users
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Offers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["offers"] = el)}
                    data-section-id="offers"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Offers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("has-offers")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("has-offers")
                            ? "border-[#EB590E] bg-[#FFF2EB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#EB590E]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("has-offers") ? "text-[#EB590E]" : "text-gray-700 dark:text-gray-300"}`}>
                          Restaurants with offers
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-4 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setIsFilterOpen(false)}
                  className="flex-1 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Close
                </button>
                <button
                  onClick={async () => {
                    setIsFilterOpen(false);
                    await applyFiltersAndRefetch(
                      activeFilters,
                      sortBy,
                      selectedCuisine,
                    );
                  }}
                  className={`flex-1 py-3 font-semibold rounded-xl transition-colors ${activeFilters.size > 0 || sortBy || selectedCuisine
                      ? "bg-[#EB590E] text-white hover:bg-[#D94F0C]"
                      : "bg-gray-200 text-gray-500"
                    }`}
                  disabled={isLoadingFilterResults}>
                  {isLoadingFilterResults
                    ? "Loading..."
                    : activeFilters.size > 0 || sortBy || selectedCuisine
                      ? `Show results`
                      : "Show results"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Veg Mode Popup */}
      <AnimatePresence>
        {showVegModePopup && (
          <motion.div
            key="veg-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setShowVegModePopup(false);
              // Revert veg mode to OFF if popup is closed without applying
              setVegModeContext(false);
              setPrevVegMode(false);
            }}
            className="fixed inset-0 bg-black/30 z-[9998] backdrop-blur-sm"
          />
        )}
        {showVegModePopup && (
          /* Popup */
          <motion.div
            key="veg-popup"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl p-6 w-[85%] max-w-xs relative border border-gray-100 dark:border-gray-800">


              {/* Title */}
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">
                See veg dishes from
              </h3>

              {/* Radio Options */}
              <div className="space-y-2 mb-4">
                {/* All restaurants */}
                <label
                  className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => setVegModeOption("all")}>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="all"
                      checked={vegModeOption === "all"}
                      onChange={() => setVegModeOption("all")}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "all"
                          ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}>
                      {vegModeOption === "all" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    All restaurants
                  </span>
                </label>

                {/* Pure Veg restaurants only */}
                <label
                  className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => setVegModeOption("pure-veg")}>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="pure-veg"
                      checked={vegModeOption === "pure-veg"}
                      onChange={() => setVegModeOption("pure-veg")}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "pure-veg"
                          ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}>
                      {vegModeOption === "pure-veg" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    Pure Veg restaurants only
                  </span>
                </label>
              </div>

              {/* Apply Button */}
              <button
                onClick={() => {
                  setShowVegModePopup(false);
                  setIsApplyingVegMode(true);
                  // Confirm veg mode is ON by updating context and prevVegMode
                  setVegModeContext(true);
                  setPrevVegMode(true);
                  // Simulate applying veg mode settings
                  setTimeout(() => {
                    setIsApplyingVegMode(false);
                  }, 2000);
                }}
                className="w-full bg-[#EB590E] text-white font-semibold py-2.5 rounded-xl hover:bg-[#D94F0C] transition-colors mb-2 text-sm">
                Apply
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Switch Off Veg Mode Popup */}
      <AnimatePresence>
        {showSwitchOffPopup && (
          <motion.div
            key="off-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              setShowSwitchOffPopup(false);
              isHandlingSwitchOff.current = false;
              setVegModeContext(true);
              // prevVegMode stays true (from before), which is correct
            }}
            className="fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
          />
        )}
        {showSwitchOffPopup && (
          <motion.div
            key="off-popup"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-0 z-[9999] flex dark:bg-[#lalala] dark:text-white items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="bg-white dark:bg-[#lalala] dark:text-white rounded-2xl shadow-2xl w-[85%] max-w-sm p-6">
              {/* Warning Icon */}
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-full bg-pink-100 flex items-center justify-center">
                  <AlertCircle
                    className="w-20 h-20 text-white bg-red-500/90 rounded-full p-2"
                    strokeWidth={2.5}
                  />
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-gray-900  text-center mb-2">
                Switch off Veg Mode?
              </h2>

              {/* Description */}
              <p className="text-gray-600 text-center mb-6 text-sm">
                You'll see all restaurants, including those serving non-veg
                dishes
              </p>

              {/* Buttons */}
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowSwitchOffPopup(false);
                    setIsSwitchingOffVegMode(true);
                    // Simulate switching off veg mode
                    setTimeout(() => {
                      setIsSwitchingOffVegMode(false);
                      isHandlingSwitchOff.current = false;
                      setVegModeContext(false);
                      setPrevVegMode(false); // Set to false to match current state (veg mode is OFF)
                    }, 2000);
                  }}
                  className="w-full bg-transparent text-red-600 font-normal py-1 text-normal rounded-xl hover:bg-red-50 transition-colors text-base">
                  Switch off
                </button>

                <button
                  onClick={() => {
                    setShowSwitchOffPopup(false);
                    isHandlingSwitchOff.current = false;
                    setVegModeContext(true);
                    // prevVegMode stays true (from before), which is correct
                  }}
                  className="w-full text-gray-900 font-normal py-1 text-center rounded-xl hover:bg-gray-200 transition-colors text-base">
                  Keep using this mode
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Categories Modal */}
      <AnimatePresence>
        {showAllCategoriesModal && (
          <motion.div
            key="cat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowAllCategoriesModal(false)}
            className="fixed inset-0 bg-black/40 z-[9998] backdrop-blur-sm"
          />
        )}
        {showAllCategoriesModal && (
          <motion.div
            key="cat-modal"
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
            }}
            className="fixed inset-x-0 bottom-0 top-12 sm:top-16 md:top-20 z-[9999] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                All Categories
              </h2>
              <button
                onClick={() => setShowAllCategoriesModal(false)}
                className="p-1.5 sm:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Close">
                <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Categories Grid - Scrollable */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
              <div className="grid grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                {displayCategories.map((category, index) => {
                  const categoryData = {
                    name: category.name || category.label,
                    image: category.image || category.imageUrl,
                    slug: category.slug,
                  };
                  return (
                    <motion.div
                      key={category.id || index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.02,
                        type: "spring",
                        stiffness: 100,
                      }}
                      whileTap={{ scale: 0.95 }}>
                      <Link
                        to={`/user/category/${categoryData.slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => setShowAllCategoriesModal(false)}
                        className="block">
                        <div className="flex flex-col items-center gap-2 sm:gap-2.5 cursor-pointer w-full">
                          <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden shadow-md transition-all hover:shadow-lg flex-shrink-0">
                            <OptimizedImage
                              src={categoryData.image}
                              alt={categoryData.name}
                              className="w-full h-full bg-white rounded-full"
                              sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                              objectFit="cover"
                              placeholder="blur"
                              onError={() => { }}
                            />
                          </div>
                          <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight px-1 break-words w-full min-w-0">
                            {categoryData.name}
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Applying Veg Mode */}
      {/* <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white/95 backdrop-blur-md flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-6">
              <div className="relative w-32 h-32 flex items-center justify-center">
                {[...Array(8)].map((_, i) => {
                  const baseSize = 112 // Starting size (w-28 = 112px)
                  const maxSize = 600 // Maximum size to expand to
                  return (
                    <motion.div
                      key={i}
                      initial={{ 
                        scale: 1,
                        opacity: 0
                      }}
                      animate={{ 
                        scale: maxSize / baseSize,
                        opacity: [0, 0.4, 0.2, 0]
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        ease: "easeOut",
                        delay: i * 0.3 // Stagger each circle by 0.3s so they appear one at a time
                      }}
                      className="absolute rounded-full border border-green-300"
                      style={{
                        width: baseSize,
                        height: baseSize,
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        transformOrigin: 'center center'
                      }}
                    />
                  )
                })}
                
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 200,
                    damping: 15,
                    delay: 0.1
                  }}
                  className="relative z-10 w-28 h-28 rounded-full border-2 border-green-300 bg-white flex flex-col items-center justify-center shadow-sm"
                >
                  <motion.div
                    className="flex flex-col items-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <span className="text-green-700 font-bold text-xs leading-none">100%</span>
                    <span className="text-green-700 font-bold text-xl leading-none mt-0.5">VEG</span>
                  </motion.div>
                </motion.div>
              </div>
              
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-gray-800 font-normal text-base text-center relative z-10"
              >
                Explore veg dishes from all restaurants
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence> */}

      <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="relative w-32 h-32 flex items-center justify-center w-full">
              {/* Animated circles - positioned absolutely at the center */}
              {[...Array(8)].map((_, i) => {
                const baseSize = 112;
                const maxSize = 600;
                return (
                  <motion.div
                    key={i}
                    initial={{
                      scale: 1,
                      opacity: 0,
                    }}
                    animate={{
                      scale: maxSize / baseSize,
                      opacity: [0, 0.4, 0.2, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeOut",
                      delay: i * 0.15,
                    }}
                    className="absolute rounded-full border border-green-300 dark:border-green-600"
                    style={{
                      width: baseSize,
                      height: baseSize,
                      // left: "50%",
                      // top: "50%",
                      // transform: "translate(-50%, -50%)",
                      // transformOrigin: "center center",
                    }}
                  />
                );
              })}

              {/* 100% VEG badge - absolute positioning at exact center */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="absolute z-10 w-28 h-28 rounded-full border-2 border-green-600 dark:border-green-500 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center shadow-sm"
                style={
                  {
                    // left: "50%",
                    // top: "50%",
                    // transform: "translate(-50%, -50%)",
                  }
                }>
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none">
                    100%
                  </span>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none mt-0.5">
                    VEG
                  </span>
                </motion.div>
              </motion.div>

              {/* Text below badge */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-xl font-normal text-gray-800 dark:text-gray-200 text-center relative z-10 mt-56 w-full">
                Explore veg dishes from all restaurants
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Switching Off Veg Mode */}
      <AnimatePresence>
        {isSwitchingOffVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              {/* Two Circles Spinning in Opposite Directions */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="relative w-16 h-16 flex items-center justify-center">
                {/* Outer Circle - Spins Clockwise */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    rotate: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-16 h-16 border-[4px] border-transparent border-t-pink-500 dark:border-t-pink-400 border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />

                {/* Inner Circle - Spins Counter-clockwise */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{
                    rotate: {
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-12 h-12 border-[4px] border-transparent border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />
              </motion.div>

              {/* Loading Text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center">
                <motion.h2
                  className="text-xl font-normal text-gray-800 dark:text-gray-200 mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}>
                  Switching off
                </motion.h2>
                <motion.p
                  className="text-xl font-normal text-gray-800 dark:text-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}>
                  Veg Mode for you
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification - Fixed to viewport bottom */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showToast && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3, type: "spring", damping: 25 }}
                className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] bg-black text-white px-6 py-3 rounded-lg shadow-2xl">
                <p className="text-sm font-medium">Added to bookmark</p>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white rounded-t-3xl shadow-2xl"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    duration: 0.2,
                    type: "spring",
                    damping: 30,
                    stiffness: 400,
                  }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">
                      Manage Collections
                    </h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors">
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                    {/* Bookmarks Collection */}
                    <div
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Don't close modal on click, let checkbox handle it
                      }}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 fill-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">
                            Bookmarks
                          </span>
                          {selectedRestaurantSlug && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isFavorite(selectedRestaurantSlug)}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    removeFavorite(selectedRestaurantSlug);
                                    setSelectedRestaurantSlug(null);
                                    setShowManageCollections(false);
                                  }
                                }}
                                className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              />
                            </div>
                          )}
                          {!selectedRestaurantSlug && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {getFavorites().length} restaurant
                          {getFavorites().length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 px-4 py-4">
                    <Button
                      className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-medium"
                      onClick={() => {
                        setSelectedRestaurantSlug(null);
                        setShowManageCollections(false);
                      }}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <React.Suspense fallback={null}>
        <StickyCartCard />
        {/* Live order strip: only on homepage (not in UserLayout) */}
        <OrderTrackingCard hasBottomNav />
      </React.Suspense>
    </div>
  );
}

