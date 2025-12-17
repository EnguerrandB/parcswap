import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const mapboxMock = vi.hoisted(() => {
  const instances = [];
  const mapCalls = [];

  const createMapInstance = (options) => {
    const listeners = new Map();
    const map = {
      __options: options,
      on: vi.fn((event, cb) => {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
        return map;
      }),
      off: vi.fn((event, cb) => {
        const set = listeners.get(event);
        if (set) set.delete(cb);
        return map;
      }),
      resize: vi.fn(),
      remove: vi.fn(),
      easeTo: vi.fn(),
      fitBounds: vi.fn(),
      getZoom: vi.fn(() => 15),
      __emit: (event, payload) => {
        const set = listeners.get(event);
        if (!set) return;
        for (const cb of set) cb(payload);
      },
    };
    return map;
  };

  function MapConstructor(options) {
    mapCalls.push(options);
    const instance = createMapInstance(options);
    instances.push(instance);
    return instance;
  }

  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }

  class LngLatBounds {
    extend() {
      return this;
    }
  }

  return {
    Map: MapConstructor,
    Marker,
    LngLatBounds,
    supported: vi.fn(() => true),
    accessToken: '',
    __mapCalls: mapCalls,
    __instances: instances,
  };
});

vi.mock('mapbox-gl', () => ({ default: mapboxMock }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, arg) => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object') return arg.defaultValue || key;
      return key;
    },
  }),
}));

beforeEach(() => {
  mapboxMock.supported.mockReset();
  mapboxMock.supported.mockReturnValue(true);
  mapboxMock.accessToken = '';
  mapboxMock.__mapCalls.length = 0;
  mapboxMock.__instances.length = 0;
});

afterEach(() => {
  cleanup();
});

const baseProps = {
  spot: { id: 'spot-1', lng: 2.295, lat: 48.8738, bookerName: 'Seeker' },
  bookerCoords: null,
  distanceText: '0.1 km',
  mapboxToken: 'test-token',
  onCancel: vi.fn(),
  onConfirmPlate: vi.fn(),
  plateInput: '',
  setPlateInput: vi.fn(),
  formatPlate: (v) => v,
  isFullPlate: () => true,
  isValidCoord: (lng, lat) => Number.isFinite(lng) && Number.isFinite(lat),
};

const renderView = async (overrides = {}) => {
  const { default: GotConfirmedView } = await import('./GotConfirmedView.jsx');
  return render(<GotConfirmedView {...baseProps} {...overrides} />);
};

describe('GotConfirmedView map init', () => {
  it('initializes Mapbox map when token is present', async () => {
    await renderView();

    await waitFor(() => {
      expect(mapboxMock.__mapCalls).toHaveLength(1);
    });

    expect(mapboxMock.accessToken).toBe('test-token');

    const options = mapboxMock.__mapCalls[0];
    expect(options.style).toBe('mapbox://styles/mapbox/streets-v12');
    expect(options.container).toBeInstanceOf(HTMLElement);
  });

  it('removes Mapbox map on unmount', async () => {
    const { unmount } = await renderView();

    await waitFor(() => {
      expect(mapboxMock.__mapCalls).toHaveLength(1);
    });

    const instance = mapboxMock.__instances[0];
    expect(instance).toBeTruthy();

    unmount();
    expect(instance.remove).toHaveBeenCalledTimes(1);
  });

  it('shows an error when WebGL is not supported', async () => {
    mapboxMock.supported.mockReturnValue(false);

    await renderView();

    expect(mapboxMock.__mapCalls).toHaveLength(0);
    expect(await screen.findByText('WebGL not supported on this device/browser')).toBeInTheDocument();
  });

  it('surfaces Mapbox errors in the UI', async () => {
    await renderView();

    await waitFor(() => {
      expect(mapboxMock.__mapCalls).toHaveLength(1);
    });

    const instance = mapboxMock.__instances[0];
    act(() => {
      instance.__emit('error', { error: { message: 'boom' } });
    });

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });
});
