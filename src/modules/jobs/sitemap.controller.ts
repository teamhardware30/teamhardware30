import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { JobsService } from './jobs.service';

@Controller()
export class SitemapController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml')
  async sitemap(@Res() res: Response): Promise<void> {
    const jobs = await this.jobsService.listSitemapJobs(5000);
    const baseUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const urls = jobs.map((job) => `<url><loc>${baseUrl}/jobs/${job.id}</loc><lastmod>${(job.updatedAt ?? job.createdAt).toISOString()}</lastmod></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }
}
