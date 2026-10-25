import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Render, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CrawlRun } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';

const RUN_STATUSES: CrawlRun['status'][] = ['running', 'success', 'partial', 'failed'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('admin')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('sources')
  @Render('admin/sources')
  async sources() {
    const [sources, metrics] = await Promise.all([this.adminService.listSources(), this.adminService.jobMetrics()]);
    return { sources, metrics, message: null };
  }

  @Patch('sources/:id/toggle')
  @Render('admin/sources')
  async toggle(@Param('id') id: string) {
    const source = await this.adminService.toggleSource(id);
    const [sources, metrics] = await Promise.all([this.adminService.listSources(), this.adminService.jobMetrics()]);
    return {
      sources,
      metrics,
      message: `${source.name} ${source.enabled ? 'enabled' : 'disabled'}`,
    };
  }

  @Patch('sources/:id/kill-switch')
  @Render('admin/sources')
  async killSwitch(@Param('id') id: string) {
    const source = await this.adminService.toggleKillSwitch(id);
    const [sources, metrics] = await Promise.all([this.adminService.listSources(), this.adminService.jobMetrics()]);
    return {
      sources,
      metrics,
      message: `${source.name} kill switch ${source.killSwitch ? 'engaged' : 'released'}`,
    };
  }

  @Post('sources/:id/run')
  @Render('admin/sources')
  async run(@Param('id') id: string) {
    await this.adminService.runNow(id);
    const [sources, metrics] = await Promise.all([this.adminService.listSources(), this.adminService.jobMetrics()]);
    return { sources, metrics, message: 'Crawl queued — check Crawl runs for progress' };
  }

  @Get('enrichment')
  @Render('admin/enrichment')
  async enrichment() {
    return {};
  }

  @Post('jobs/:id/re-enrich')
  @HttpCode(HttpStatus.OK)
  async reEnrichJob(@Param('id') id: string, @Res() res: Response) {
    await this.adminService.reEnrichJob(id);
    res.redirect('/admin/enrichment');
  }

  @Post('jobs/re-enrich-one')
  @HttpCode(HttpStatus.OK)
  async reEnrichOne(@Body() body: Record<string, string>, @Res() res: Response) {
    if (body.jobId) await this.adminService.reEnrichJob(body.jobId);
    res.redirect('/admin/enrichment');
  }

  @Post('jobs/re-enrich')
  @HttpCode(HttpStatus.OK)
  async reEnrichJobs(@Body() body: Record<string, string>, @Res() res: Response) {
    const from = new Date(body.from);
    const to = new Date(body.to);
    const limit = Number(body.limit || 25);
    await this.adminService.reEnrichJobs(from, to, limit);
    res.redirect('/admin/enrichment');
  }

  @Get('crawl-runs')
  @Render('admin/crawl-runs')
  async crawlRuns(@Query() query: Record<string, unknown>) {
    const sourceId = typeof query.sourceId === 'string' && UUID_PATTERN.test(query.sourceId) ? query.sourceId : undefined;
    const status = RUN_STATUSES.includes(query.status as CrawlRun['status'])
      ? (query.status as CrawlRun['status'])
      : undefined;
    const requestedPage = typeof query.page === 'string' ? Number(query.page) : 1;
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
    return this.adminService.listCrawlRunsPage({ sourceId, status, page });
  }
}
