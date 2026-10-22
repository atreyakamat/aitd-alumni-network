import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiError, ok } from '@/components/profile/__tests__/mocks';

const authState = { user: { id: 'me', fullName: 'Me Myself' }, isLoading: false, isAuthenticated: true };
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

const userApi = vi.hoisted(() => ({ getProfile: vi.fn(), getLocations: vi.fn(), getNearby: vi.fn() }));
const geoApi = vi.hoisted(() => ({ search: vi.fn(), reverse: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
  geoApi,
}));

// The real map needs Leaflet + a DOM layout; a stub records props and reports a viewport.
const mapProps = vi.hoisted(() => ({ current: null as any }));
const VIEWPORT = { north: 20.123456, south: 10, east: 80, west: 70 };
vi.mock('next/dynamic', () => ({
  default: () =>
    function MockAlumniMap(props: any) {
      mapProps.current = props;
      const { onBoundsChange } = props;
      useEffect(() => {
        onBoundsChange?.(VIEWPORT);
      }, [onBoundsChange]);
      return <div data-testid="alumni-map" data-count={props.alumni.length} />;
    },
}));

import AlumniNearbyPage from '@/app/(main)/alumni-nearby/page';

const pin = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  fullName: `Alum ${id}`,
  profilePhotoUrl: null,
  city: 'Pune',
  batchYear: 2015,
  department: 'Civil',
  currentDesignation: 'Engineer',
  locationLat: 18.52,
  locationLng: 73.86,
  ...over,
});

const myProfile = (over: Record<string, unknown> = {}) => ({
  id: 'me',
  fullName: 'Me Myself',
  batchYear: 2016,
  department: 'Civil',
  degree: 'B.E.',
  isLocationPublic: true,
  locationLat: 15.49,
  locationLng: 73.83,
  ...over,
});

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
const stubGeolocation = (impl: (success: PositionCallback, error: PositionErrorCallback) => void) =>
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn(impl) } });

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlumniNearbyPage />
    </QueryClientProvider>
  );
};

const lastLocationsCall = () => userApi.getLocations.mock.calls.at(-1);
const lastNearbyCall = () => userApi.getNearby.mock.calls.at(-1);
const resultList = () => screen.getByRole('list', { name: 'Alumni on the map' });

beforeEach(() => {
  mapProps.current = null;
  userApi.getProfile.mockReset().mockResolvedValue(ok(myProfile()));
  userApi.getLocations.mockReset().mockResolvedValue(ok([pin('a'), pin('b', { city: 'Mumbai' })]));
  userApi.getNearby.mockReset().mockResolvedValue(
    ok({
      centerLat: 12.97,
      centerLng: 77.59,
      radiusKm: 25,
      alumni: [pin('far', { distanceKm: 12.6 }), pin('near', { distanceKm: 0.4 })],
    })
  );
  geoApi.search.mockReset().mockResolvedValue(ok([]));
  geoApi.reverse.mockReset().mockResolvedValue(ok(null));
});

afterEach(() => {
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  else delete (navigator as any).geolocation;
});

describe('Alumni Nearby page — explore mode', () => {
  it('loads pins for the visible map area and lists them', async () => {
    renderPage();

    await waitFor(() => expect(within(resultList()).getAllByRole('button')).toHaveLength(2));
    expect(lastLocationsCall()).toEqual([
      { north: 20.1235, south: 10, east: 80, west: 70, limit: 1000 },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(screen.getByTestId('result-summary')).toHaveTextContent('2 alumni in this area');
    expect(screen.getByTestId('alumni-map')).toHaveAttribute('data-count', '2');
  });

  it('centres on the saved profile location', async () => {
    renderPage();
    await waitFor(() => expect(mapProps.current.view.center).toEqual([15.49, 73.83]));
  });

  it('sends batch, department and name filters to the server', async () => {
    renderPage();
    await waitFor(() => expect(userApi.getLocations).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText('Batch'), '2015');
    await userEvent.selectOptions(screen.getByLabelText('Department'), 'Civil');
    await userEvent.type(screen.getByLabelText('Search alumni by name'), 'ada');

    await waitFor(
      () =>
        expect(lastLocationsCall()?.[0]).toMatchObject({ batchYear: 2015, department: 'Civil', search: 'ada' }),
      { timeout: 2000 }
    );
  });

  it('shows an error with a working retry', async () => {
    userApi.getLocations.mockRejectedValueOnce(apiError(500, 'Database unavailable'));
    renderPage();

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(resultList()).getAllByRole('button')).toHaveLength(2));
  });

  it('offers to clear filters when nothing matches', async () => {
    renderPage();
    await waitFor(() => expect(userApi.getLocations).toHaveBeenCalled());
    userApi.getLocations.mockResolvedValue(ok([]));

    await userEvent.selectOptions(screen.getByLabelText('Batch'), '2001');
    expect(await screen.findByText(/no alumni in this area/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Batch')).toHaveValue('');
  });

  it('focuses a pin on the map when picked from the list', async () => {
    renderPage();
    const list = await waitFor(() => resultList());
    await userEvent.click(within(list).getByRole('button', { name: /Alum b/ }));

    expect(mapProps.current.selectedId).toBe('b');
    expect(mapProps.current.focusToken).toBe(1);
    expect(within(list).getByRole('button', { name: /Alum b/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('recentres the map on a searched place', async () => {
    geoApi.search.mockResolvedValue(ok([{ label: 'Bengaluru, Karnataka, India', lat: 12.97, lng: 77.59, city: 'Bengaluru' }]));
    renderPage();

    await userEvent.type(screen.getByLabelText('Go to a place'), 'Bengaluru');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bengaluru, Karnataka, India' }));

    expect(mapProps.current.view.center).toEqual([12.97, 77.59]);
    expect(screen.queryByRole('list', { name: 'Matching places' })).not.toBeInTheDocument();
  });

  it('degrades gracefully when the geocoder is unavailable', async () => {
    geoApi.search.mockRejectedValue(apiError(503, 'Geocoder unavailable'));
    renderPage();

    await userEvent.type(screen.getByLabelText('Go to a place'), 'Pune');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(await screen.findByTestId('geocoder-down')).toBeInTheDocument();
    expect(screen.getByLabelText('Go to a place')).toBeDisabled();
  });
});

describe('Alumni Nearby page — near me', () => {
  it('searches around the GPS position, sorted by distance, with a radius', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 12.97, longitude: 77.59 } } as GeolocationPosition));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Near me' }));

    await waitFor(() => expect(within(resultList()).getAllByRole('button')).toHaveLength(2));
    expect(lastNearbyCall()).toEqual([12.97, 77.59, 25, 200, { filters: {}, signal: expect.any(AbortSignal) }]);
    const rows = within(resultList()).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Alum near');
    expect(rows[0]).toHaveTextContent('< 1 km');
    expect(rows[1]).toHaveTextContent('13 km');
    expect(screen.getByTestId('result-summary')).toHaveTextContent('within 25 km of your current location');
    expect(mapProps.current.radius).toEqual({ center: [12.97, 77.59], km: 25 });
    expect(mapProps.current.userLocation).toEqual([12.97, 77.59]);

    await userEvent.selectOptions(screen.getByLabelText('Radius'), '100');
    await waitFor(() => expect(lastNearbyCall()?.[2]).toBe(100));
    expect(mapProps.current.radius.km).toBe(100);
  });

  it('explains a denied permission and falls back to the saved profile location', async () => {
    stubGeolocation((_s, error) => error({ code: 1, message: 'denied' } as GeolocationPositionError));
    renderPage();
    await waitFor(() => expect(userApi.getProfile).toHaveBeenCalled());
    await screen.findByTestId('alumni-map');

    await userEvent.click(screen.getByRole('button', { name: 'Near me' }));

    expect(await screen.findByTestId('geo-error')).toHaveTextContent(/permission was denied/i);
    await waitFor(() => expect(lastNearbyCall()?.slice(0, 2)).toEqual([15.49, 73.83]));
    expect(screen.getByTestId('geo-error')).toHaveTextContent(/saved profile location/i);
    expect(screen.getByTestId('result-summary')).toHaveTextContent('your saved profile location');
  });

  it('lets a member without GPS or a saved location pick a centre by place search', async () => {
    userApi.getProfile.mockResolvedValue(ok(myProfile({ isLocationPublic: false, locationLat: null, locationLng: null })));
    stubGeolocation((_s, error) => error({ code: 2, message: 'unavailable' } as GeolocationPositionError));
    geoApi.search.mockResolvedValue(ok([{ label: 'Panaji, Goa, India', lat: 15.49, lng: 73.83, city: 'Panaji' }]));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Near me' }));
    expect(await screen.findByText(/search for a place to find alumni nearby/i)).toBeInTheDocument();
    expect(userApi.getNearby).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Go to a place'), 'Panaji');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Panaji, Goa, India' }));

    await waitFor(() => expect(lastNearbyCall()?.slice(0, 3)).toEqual([15.49, 73.83, 25]));
    expect(screen.getByTestId('result-summary')).toHaveTextContent('within 25 km of Panaji');
  });
});

describe('Alumni Nearby page — sharing banner', () => {
  it('asks members who are not on the map to share a location', async () => {
    userApi.getProfile.mockResolvedValue(ok(myProfile({ isLocationPublic: false })));
    renderPage();
    const banner = await screen.findByTestId('share-location-banner');
    expect(within(banner).getByRole('link', { name: 'Update my location' })).toHaveAttribute(
      'href',
      '/profile/edit#privacy'
    );
  });

  it('stays hidden for members already sharing', async () => {
    renderPage();
    await waitFor(() => expect(userApi.getProfile).toHaveBeenCalledWith('me'));
    await waitFor(() => expect(mapProps.current.view.center).toEqual([15.49, 73.83]));
    expect(screen.queryByTestId('share-location-banner')).not.toBeInTheDocument();
  });
});
