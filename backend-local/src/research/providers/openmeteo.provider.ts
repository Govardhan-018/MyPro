import type { ResearchHttpService } from '../http.service';
import type { WeatherProvider, WeatherQuery, WeatherReport } from '../provider.types';

/**
 * Open-Meteo — free, keyless, no account, generous limits.
 *
 * Two calls when given a place name (geocode, then forecast), one when given
 * coordinates. WMO weather codes are turned into plain language here so
 * nothing above this file has to know what a 95 is.
 */
export class OpenMeteoProvider implements WeatherProvider {
  readonly id = 'open-meteo';
  readonly kind = 'weather' as const;
  readonly free = true;
  readonly note = 'Forecast and current conditions. No key. ~10,000 calls/day.';

  constructor(private readonly http: ResearchHttpService) {}

  configured(): boolean {
    return true;
  }

  async forecast(query: WeatherQuery): Promise<WeatherReport> {
    const location = await this.locate(query);
    const days = Math.max(1, Math.min(query.days, 16));

    const data = await this.http.fetchJson<{
      timezone?: string;
      current?: {
        temperature_2m?: number;
        wind_speed_10m?: number;
        precipitation?: number;
        weather_code?: number;
      };
      daily?: {
        time?: string[];
        temperature_2m_min?: (number | null)[];
        temperature_2m_max?: (number | null)[];
        precipitation_sum?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
        wind_speed_10m_max?: (number | null)[];
        weather_code?: (number | null)[];
      };
    }>('https://api.open-meteo.com/v1/forecast', {
      query: {
        latitude: location.latitude,
        longitude: location.longitude,
        daily:
          'weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
        current: 'temperature_2m,precipitation,weather_code,wind_speed_10m',
        forecast_days: days,
        wind_speed_unit: 'kmh',
        timezone: query.timezone || location.timezone || 'auto',
      },
      accept: 'application/json',
    });

    const daily = data.daily ?? {};
    const times = daily.time ?? [];
    const at = (list: (number | null)[] | undefined, i: number): number | undefined => {
      const value = list?.[i];
      return typeof value === 'number' ? value : undefined;
    };

    return {
      place: location.place,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: data.timezone ?? query.timezone ?? 'UTC',
      now: data.current
        ? {
            temperature_c: data.current.temperature_2m,
            wind_kph: data.current.wind_speed_10m,
            precipitation_mm: data.current.precipitation,
            summary: describeCode(data.current.weather_code),
          }
        : undefined,
      days: times.map((date, i) => ({
        date,
        min_c: at(daily.temperature_2m_min, i),
        max_c: at(daily.temperature_2m_max, i),
        precipitation_mm: at(daily.precipitation_sum, i),
        precipitation_chance: at(daily.precipitation_probability_max, i),
        wind_kph: at(daily.wind_speed_10m_max, i),
        summary: describeCode(at(daily.weather_code, i)),
      })),
      provider: this.id,
      fetched_at: new Date().toISOString(),
    };
  }

  /** Coordinates win; a place name is geocoded; neither is an error. */
  private async locate(query: WeatherQuery): Promise<{
    place: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  }> {
    if (typeof query.latitude === 'number' && typeof query.longitude === 'number') {
      return {
        place: `${query.latitude.toFixed(3)}, ${query.longitude.toFixed(3)}`,
        latitude: query.latitude,
        longitude: query.longitude,
      };
    }

    const place = (query.place ?? '').trim();
    if (!place) throw new Error('No place or coordinates given for the forecast');

    const geo = await this.http.fetchJson<{
      results?: {
        name?: string;
        latitude?: number;
        longitude?: number;
        country?: string;
        admin1?: string;
        timezone?: string;
      }[];
    }>('https://geocoding-api.open-meteo.com/v1/search', {
      query: { name: place, count: 1, language: 'en', format: 'json' },
      accept: 'application/json',
    });

    const hit = geo.results?.[0];
    if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
      throw new Error(`Could not find a place called "${place}"`);
    }

    return {
      place: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone,
    };
  }
}

/** WMO weather interpretation codes, in words. */
export function describeCode(code?: number): string | undefined {
  if (code === undefined) return undefined;
  const table: Record<number, string> = {
    0: 'clear',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'freezing fog',
    51: 'light drizzle',
    53: 'drizzle',
    55: 'heavy drizzle',
    56: 'freezing drizzle',
    57: 'freezing drizzle',
    61: 'light rain',
    63: 'rain',
    65: 'heavy rain',
    66: 'freezing rain',
    67: 'heavy freezing rain',
    71: 'light snow',
    73: 'snow',
    75: 'heavy snow',
    77: 'snow grains',
    80: 'light showers',
    81: 'showers',
    82: 'violent showers',
    85: 'snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with hail',
    99: 'thunderstorm with heavy hail',
  };
  return table[code];
}
