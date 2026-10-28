import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, ok } from './mocks';

const toast = vi.hoisted(() => vi.fn());
const userApi = vi.hoisted(() => ({ updateProfile: vi.fn() }));
const geoApi = vi.hoisted(() => ({ search: vi.fn(), reverse: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  userApi,
  geoApi,
}));

import { PrivacySection } from '@/components/profile/PrivacySection';

const profile = {
  id: 'me',
  fullName: 'Ada Alum',
  batchYear: 2015,
  department: 'CS',
  degree: 'B.E.',
  city: 'Delhi',
  hometown: '',
  phoneVisibility: 'PRIVATE' as const,
  isLocationPublic: false,
  locationLat: null,
  locationLng: null,
};

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

const stubGeolocation = (impl: (success: PositionCallback, error: PositionErrorCallback) => void) => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(impl) },
  });
};

beforeEach(() => {
  toast.mockReset();
  userApi.updateProfile.mockReset().mockResolvedValue(ok());
  geoApi.search.mockReset().mockResolvedValue(ok([]));
  geoApi.reverse.mockReset().mockResolvedValue(ok(null));
});

afterEach(() => {
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  else delete (navigator as any).geolocation;
});

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save privacy settings' }));

describe('<PrivacySection>', () => {
  it('sends phone visibility, map toggle and places', async () => {
    const onSaved = vi.fn();
    render(<PrivacySection profile={profile} onSaved={onSaved} />);

    await userEvent.selectOptions(screen.getByLabelText('Who can see my phone number'), 'CONNECTIONS');
    await userEvent.click(screen.getByLabelText('Show my location on the alumni map'));
    await userEvent.type(screen.getByLabelText('Hometown'), 'Jaipur');
    await save();

    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith({
        phoneVisibility: 'CONNECTIONS',
        isLocationPublic: true,
        city: 'Delhi',
        hometown: 'Jaipur',
        homeLat: null,
        homeLng: null,
        workCity: null,
        workLat: null,
        workLng: null,
      })
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Privacy settings saved' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('turning the map toggle off is sent as false', async () => {
    render(<PrivacySection profile={{ ...profile, isLocationPublic: true, locationLat: 28.6, locationLng: 77.2 }} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Show my location on the alumni map'));
    await save();
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ isLocationPublic: false, homeLat: 28.6, homeLng: 77.2 })
      )
    );
  });

  it('uses the browser location rounded to 2 decimals (about 1 km)', async () => {
    stubGeolocation((success) =>
      success({ coords: { latitude: 28.6139391, longitude: 77.2090212 } } as GeolocationPosition)
    );
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByTestId('location-status')).toHaveTextContent('28.61, 77.21');
    await save();

    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ homeLat: 28.61, homeLng: 77.21 }))
    );
    expect(geoApi.reverse).toHaveBeenCalledWith(28.61, 77.21, { signal: undefined });
  });

  it('explains a denied location permission without saving anything', async () => {
    stubGeolocation((_success, error) => error({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError));
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission was denied/i);
    expect(screen.getByTestId('location-status')).toHaveTextContent('No map location set');
    expect(screen.getByRole('button', { name: 'Use my current location' })).toBeEnabled();
    expect(userApi.updateProfile).not.toHaveBeenCalled();
  });

  it('handles browsers without geolocation', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not support/i);
  });

  it('fills an empty city from the detected location', async () => {
    geoApi.reverse.mockResolvedValue(ok({ label: 'New Delhi, Delhi, India', lat: 28.61, lng: 77.21, city: 'New Delhi' }));
    stubGeolocation((success) => success({ coords: { latitude: 28.6139, longitude: 77.209 } } as GeolocationPosition));
    render(<PrivacySection profile={{ ...profile, city: '' }} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));

    await waitFor(() => expect(screen.getByLabelText('Current city')).toHaveValue('New Delhi'));
    expect(screen.getByTestId('city-filled')).toBeInTheDocument();
  });

  it('only suggests a different city when the member already typed one', async () => {
    geoApi.reverse.mockResolvedValue(ok({ label: 'Gurugram, Haryana, India', lat: 28.46, lng: 77.03, city: 'Gurugram' }));
    stubGeolocation((success) => success({ coords: { latitude: 28.4595, longitude: 77.0266 } } as GeolocationPosition));
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    const useSuggestion = await screen.findByRole('button', { name: 'Use Gurugram' });
    expect(screen.getByLabelText('Current city')).toHaveValue('Delhi');

    await userEvent.click(useSuggestion);
    expect(screen.getByLabelText('Current city')).toHaveValue('Gurugram');
  });

  it('still saves the location when reverse geocoding is unavailable', async () => {
    geoApi.reverse.mockRejectedValue(apiError(503, 'Geocoder unavailable'));
    stubGeolocation((success) => success({ coords: { latitude: 28.6139, longitude: 77.209 } } as GeolocationPosition));
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(await screen.findByTestId('geocoder-down')).toBeInTheDocument();
    expect(screen.getByLabelText('Current city')).toHaveValue('Delhi');
    await save();
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ homeLat: 28.61, homeLng: 77.21 }))
    );
  });

  it('sets the location from a place search without submitting the form', async () => {
    geoApi.search.mockResolvedValue(
      ok([
        { label: 'Panaji, North Goa, Goa, India', lat: 15.4909, lng: 73.8278, city: 'Panaji' },
        { label: 'Panaji Market, Goa, India', lat: 15.5, lng: 73.83, city: 'Panaji' },
      ])
    );
    render(<PrivacySection profile={{ ...profile, city: '' }} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Or find your area by name'), 'Panaji{Enter}');
    expect(userApi.updateProfile).not.toHaveBeenCalled();
    expect(geoApi.search).toHaveBeenCalledWith('Panaji', 5, { signal: undefined });

    await userEvent.click(await screen.findByRole('button', { name: 'Panaji, North Goa, Goa, India' }));
    expect(screen.getByTestId('location-status')).toHaveTextContent('15.49, 73.83');
    expect(screen.getByLabelText('Current city')).toHaveValue('Panaji');
    expect(screen.queryByRole('list', { name: 'Matching places' })).not.toBeInTheDocument();

    await save();
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ city: 'Panaji', locationLat: 15.49, locationLng: 73.83 })
      )
    );
  });

  it('tells the member when no place matches or the query is too short', async () => {
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Or find your area by name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Find place' }));
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
    expect(geoApi.search).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Or find your area by name'), 'yzzy');
    await userEvent.click(screen.getByRole('button', { name: 'Find place' }));
    expect(await screen.findByText('No matching places found.')).toBeInTheDocument();
  });

  it('disables place search when the geocoder is unavailable', async () => {
    geoApi.search.mockRejectedValue(apiError(503, 'Geocoder unavailable'));
    render(<PrivacySection profile={profile} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Or find your area by name'), 'Pune');
    await userEvent.click(screen.getByRole('button', { name: 'Find place' }));

    expect(await screen.findByTestId('geocoder-down')).toBeInTheDocument();
    expect(screen.getByLabelText('Or find your area by name')).toBeDisabled();
  });

  it('can clear a saved location', async () => {
    render(<PrivacySection profile={{ ...profile, locationLat: 28.6, locationLng: 77.2 }} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear location' }));
    await save();
    await waitFor(() =>
      expect(userApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ locationLat: null, locationLng: null }))
    );
  });
});
