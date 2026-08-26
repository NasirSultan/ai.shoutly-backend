import { Injectable, InternalServerErrorException } from '@nestjs/common'
import axios from 'axios'
import FormData from 'form-data'
import { Express } from 'express'
@Injectable()
export class ImgbbService {
  private readonly imgbbKey = process.env.IMGBB_KEY

  async uploadFile(file: Express.Multer.File): Promise<{ imageUrl: string; deleteUrl: string }> {
    return this.uploadBuffer(file.buffer)
  }

  // expirationSeconds (ImgBB's own auto-delete window, 60–15552000) is
  // optional — omit it for source assets someone may reuse later (logos,
  // templates); pass it for disposable outputs (rendered layouts) that
  // shouldn't accumulate on ImgBB forever. ImgBB deletes the file itself
  // once it expires, no cleanup job needed on our side.
  async uploadBuffer(buffer: Buffer, expirationSeconds?: number): Promise<{ imageUrl: string; deleteUrl: string }> {
    if (!this.imgbbKey) throw new InternalServerErrorException('ImgBB API key not set')

    const form = new FormData()
    form.append('image', buffer.toString('base64'))
    if (expirationSeconds) form.append('expiration', String(expirationSeconds))

    try {
      const res = await axios.post(`https://api.imgbb.com/1/upload?key=${this.imgbbKey}`, form, {
        headers: form.getHeaders()
      })

      return {
        imageUrl: res.data.data.url,
        deleteUrl: res.data.data.delete_url
      }
    } catch (error: any) {
      throw new InternalServerErrorException(error.response?.data || error.message)
    }
  }

async uploadMultipleFiles(files: Express.Multer.File[]): Promise<{ imageUrl: string; deleteUrl: string }[]> {
  const results: { imageUrl: string; deleteUrl: string }[] = []
  for (const file of files) {
    const uploaded = await this.uploadFile(file)
    results.push(uploaded)
  }
  return results
}

 async uploadBrandLogo(file: Express.Multer.File): Promise<string> {
    const uploaded = await this.uploadFile(file)
    return uploaded.imageUrl
  }
    async deleteFile(deleteUrl: string) {
    try {
      await axios.get(deleteUrl);
    } catch (error: any) {
      throw new InternalServerErrorException(error.response?.data || error.message);
    }
  }
}