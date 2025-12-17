import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const mapboxMock = vi.hoisted(() => {
  const instances = [];
  const mapCalls = [];
  const popupCalls = [];
  const popupInstances = [];

  const createMapInstance = (options) => {
    const listeners = new Map();
    const sources = new Map();
    const layers = new Map();
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
      addSource: vi.fn((id, source) => {
        sources.set(id, {
          ...source,
          setData: vi.fn((data) => {
            sources.set(id, { ...sources.get(id), data });
          }),
        });
        return map;
      }),
      addLayer: vi.fn((layer) => {
        layers.set(layer.id, layer);
        return map;
      }),
      getSource: vi.fn((id) => sources.get(id)),
      getLayer: vi.fn((id) => layers.get(id)),
      removeLayer: vi.fn((id) => {
        layers.delete(id);
        return map;
      }),
      removeSource: vi.fn((id) => {
        sources.delete(id);
        return map;
      }),
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

  class Popup {
    constructor(options) {
      this.__options = options;
      popupCalls.push(options);
      popupInstances.push(this);
      this.setDOMContent = vi.fn(() => this);
      this.setLngLat = vi.fn(() => this);
      this.addTo = vi.fn(() => this);
      this.remove = vi.fn(() => this);
    }
  }

  class LngLatBounds {
    extend() {
      return this;
    }
  }

  return {
    Map: MapConstructor,
    Marker,
    Popup,
    LngLatBounds,
    supported: vi.fn(() => true),
    accessToken: '',
    __mapCalls: mapCalls,
    __instances: instances,
    __popupCalls: popupCalls,
    __popupInstances: popupInstances,
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
  mapboxMock.__popupCalls.length = 0;
  mapboxMock.__popupInstances.length = 0;
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      routes: [
        {
          geometry: { coordinates: [[2.295, 48.8738], [2.2955, 48.8742], [2.296, 48.874]] },
        },
      ],
    }),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe('GotConfirmedView driver popup', () => {
  it('creates an always-on-screen popup for the other user', async () => {
    await renderView({ bookerCoords: { lng: 2.296, lat: 48.874 } });

    await waitFor(() => {
      expect(mapboxMock.__instances).toHaveLength(1);
    });

    const instance = mapboxMock.__instances[0];
    act(() => {
      instance.__emit('load');
    });

    await waitFor(() => {
      expect(mapboxMock.__popupInstances).toHaveLength(1);
    });

    expect(mapboxMock.__popupCalls[0]).toMatchObject({
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      offset: 18,
      maxWidth: '260px',
    });
    expect(mapboxMock.__popupCalls[0].anchor).toBeUndefined();
    expect(mapboxMock.__popupCalls[0].className).toContain('driver-info-popup');

    const popup = mapboxMock.__popupInstances[0];
    expect(popup.setLngLat).toHaveBeenCalledWith([2.296, 48.874]);
    const contentNode = popup.setDOMContent.mock.calls[0]?.[0];
    expect(contentNode).toBeInstanceOf(HTMLElement);
    expect(contentNode.textContent).toContain('Seeker');
    expect(contentNode.textContent).toContain('Transactions');
    expect(contentNode.textContent).not.toContain('Driver');
  });

  it('removes popup on unmount', async () => {
    const { unmount } = await renderView({ bookerCoords: { lng: 2.296, lat: 48.874 } });

    await waitFor(() => {
      expect(mapboxMock.__instances).toHaveLength(1);
    });

    const instance = mapboxMock.__instances[0];
    act(() => {
      instance.__emit('load');
    });

    await waitFor(() => {
      expect(mapboxMock.__popupInstances).toHaveLength(1);
    });

    const popup = mapboxMock.__popupInstances[0];
    unmount();
    expect(popup.remove).toHaveBeenCalled();
  });
});

describe('GotConfirmedView route', () => {
  it('draws an app-colored route between spot and booker', async () => {
    await renderView({ bookerCoords: { lng: 2.296, lat: 48.874 } });

    await waitFor(() => {
      expect(mapboxMock.__instances).toHaveLength(1);
    });

    const instance = mapboxMock.__instances[0];
    act(() => {
      instance.__emit('load');
    });

    await waitFor(() => {
      expect(instance.addSource).toHaveBeenCalled();
      expect(instance.addLayer).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const layerArg = instance.addLayer.mock.calls[0][0];
    expect(layerArg.type).toBe('line');
    expect(layerArg.paint['line-color']).toBe('#f97316');

    const sourceArg = instance.addSource.mock.calls[0][1];
    expect(sourceArg.type).toBe('geojson');
    expect(sourceArg.data.geometry.coordinates).toEqual([[2.295, 48.8738], [2.2955, 48.8742], [2.296, 48.874]]);
  });
});

describe('GotConfirmedView cancel flow', () => {
  it('opens a confirmation modal and warns about reputation before canceling', async () => {
    const onCancel = vi.fn();
    await renderView({ onCancel });

    const cancelButton = await screen.findByText('Cancel');
    act(() => {
      cancelButton.click();
    });

    expect(
      await screen.findByText(
        'Canceling now may hurt your reputation: the other user is already on the way.',
      ),
    ).toBeInTheDocument();

    expect(onCancel).not.toHaveBeenCalled();

    const confirmButton = await screen.findByText('Cancel anyway');
    act(() => {
      confirmButton.click();
    });

    expect(onCancel).toHaveBeenCalledWith('spot-1');
  });
});
