import { useEffect, useRef, useState, useCallback } from "react";

const useFiltersAnimation = ({ viewRef, onFiltersOpenChange }) => {
  const filtersButtonRef = useRef(null);
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [filtersPanelTopPx, setFiltersPanelTopPx] = useState(null);

  // 1. Calcul optimisé de la position du panneau (évite les re-renders inutiles)
  const updateFiltersPanelTop = useCallback(() => {
    if (!viewRef?.current || !filtersButtonRef.current) return;

    const viewRect = viewRef.current.getBoundingClientRect();
    const buttonRect = filtersButtonRef.current.getBoundingClientRect();
    const top = buttonRect.bottom - viewRect.top + 10;
    const newTop = Math.max(0, Math.round(top));

    setFiltersPanelTopPx((prev) => (prev !== newTop ? newTop : prev));
  }, [viewRef]);

  // 2. Gestion des events globaux (Scroll / Resize)
  useEffect(() => {
    if (!showRadiusPicker) return;

    // On met à jour immédiatement
    updateFiltersPanelTop();

    const handleScrollOrResize = () => {
      // On utilise requestAnimationFrame juste pour throttler l'exécution, pas pour looper
      window.requestAnimationFrame(updateFiltersPanelTop);
    };

    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("orientationchange", handleScrollOrResize);
    window.visualViewport?.addEventListener("resize", handleScrollOrResize);
    window.visualViewport?.addEventListener("scroll", handleScrollOrResize);

    return () => {
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("orientationchange", handleScrollOrResize);
      window.visualViewport?.removeEventListener(
        "resize",
        handleScrollOrResize
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        handleScrollOrResize
      );
    };
  }, [showRadiusPicker, updateFiltersPanelTop]);

  // 3. Synchro avec le parent
  useEffect(() => {
    onFiltersOpenChange?.(showRadiusPicker);
    // Cleanup optionnel si besoin : onFiltersOpenChange?.(false);
  }, [showRadiusPicker, onFiltersOpenChange]);

  return {
    showRadiusPicker,
    setShowRadiusPicker,
    filtersButtonRef,
    filtersPanelTopPx,
  };
};

export default useFiltersAnimation;
