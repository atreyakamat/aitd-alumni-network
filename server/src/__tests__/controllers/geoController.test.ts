import { api, authAs } from '../../../tests/helpers';
import { geocodingService } from '../../services/geocodingService';
import { AppError } from '../../middleware/errorHandler';

describe('geo routes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('GET /api/geo/search requires authentication', async () => {
    const res = await api().get('/api/geo/search?q=Pune');
    expect(res.status).toBe(401);
  });

  it('GET /api/geo/search returns places', async () => {
    const { header } = authAs('MEMBER');
    const search = jest
      .spyOn(geocodingService, 'search')
      .mockResolvedValue([{ label: 'Pune, India', lat: 18.52, lng: 73.85, city: 'Pune' }]);

    const res = await api().get('/api/geo/search?q=Pune&limit=3').set('Authorization', header);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ label: 'Pune, India', lat: 18.52, lng: 73.85, city: 'Pune' }] });
    expect(search).toHaveBeenCalledWith('Pune', 3);
  });

  it('GET /api/geo/search rejects a missing query with 400', async () => {
    const { header } = authAs('MEMBER');
    const search = jest.spyOn(geocodingService, 'search');

    const res = await api().get('/api/geo/search').set('Authorization', header);

    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('GET /api/geo/search surfaces 503 GEOCODER_UNAVAILABLE', async () => {
    const { header } = authAs('MEMBER');
    jest
      .spyOn(geocodingService, 'search')
      .mockRejectedValue(new AppError('Place search is unavailable', 503, 'GEOCODER_UNAVAILABLE'));

    const res = await api().get('/api/geo/search?q=Pune').set('Authorization', header);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GEOCODER_UNAVAILABLE');
  });

  it('GET /api/geo/reverse returns the nearest place', async () => {
    const { header } = authAs('MEMBER');
    const reverse = jest
      .spyOn(geocodingService, 'reverse')
      .mockResolvedValue({ label: 'Pune, India', lat: 18.52, lng: 73.85, city: 'Pune' });

    const res = await api().get('/api/geo/reverse?lat=18.52&lng=73.85').set('Authorization', header);

    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('Pune');
    expect(reverse).toHaveBeenCalledWith(18.52, 73.85);
  });

  it('GET /api/geo/reverse returns null data when nothing is found', async () => {
    const { header } = authAs('MEMBER');
    jest.spyOn(geocodingService, 'reverse').mockResolvedValue(null);

    const res = await api().get('/api/geo/reverse?lat=0&lng=-30').set('Authorization', header);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('GET /api/geo/reverse validates coordinates before calling out', async () => {
    const { header } = authAs('MEMBER');
    const reverse = jest.spyOn(geocodingService, 'reverse');

    for (const qs of ['lat=abc&lng=1', 'lat=1', 'lat=95&lng=0', 'lat=0&lng=200']) {
      const res = await api().get(`/api/geo/reverse?${qs}`).set('Authorization', header);
      expect(res.status).toBe(400);
    }
    expect(reverse).not.toHaveBeenCalled();
  });
});
