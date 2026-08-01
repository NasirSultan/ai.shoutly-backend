import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common'
import axios from 'axios'

const BASE_URL = 'https://calendarific.com/api/v2'

@Injectable()
export class CalendarificService {
  private readonly apiKey = process.env.CALENDARIFIC_API_KEY

  async getHolidays(params: {
    country: string
    year: number
    type?: string
    month?: number
    day?: number
    location?: string
  }) {
    if (!this.apiKey) throw new InternalServerErrorException('Calendarific API key not set')
    if (!params.country) throw new BadRequestException('country is required')
    if (!params.year) throw new BadRequestException('year is required')

    try {
      const res = await axios.get(`${BASE_URL}/holidays`, {
        params: {
          api_key: this.apiKey,
          country: params.country,
          year: params.year,
          type: params.type ?? 'observance',
          month: params.month,
          day: params.day,
          location: params.location,
        },
      })

      return res.data?.response?.holidays ?? []
    } catch (error: any) {
      throw new InternalServerErrorException(error.response?.data?.meta || error.message)
    }
  }

  async getCountries() {
    if (!this.apiKey) throw new InternalServerErrorException('Calendarific API key not set')

    try {
      const res = await axios.get(`${BASE_URL}/countries`, {
        params: { api_key: this.apiKey },
      })

      return res.data?.response?.countries ?? []
    } catch (error: any) {
      throw new InternalServerErrorException(error.response?.data?.meta || error.message)
    }
  }
}
