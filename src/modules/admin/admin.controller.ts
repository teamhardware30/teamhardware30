import { Controller, Get, Param, Patch, Post, Render, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('sources')
  @Render('admin/sources')
  async sources() {
    return { sources: await this.adminService.listSources(), message: null };
  }

  @Patch('sources/:id/toggle')
  @Render('admin/sources')
  async toggle(@Param('id') id: string) {
    const source = await this.adminService.toggleSource(id);
    return {
      sources: await this.adminService.listSources(),
      message: `${source.name} ${source.enabled ? 'enabled' : 'disabled'}`,
    };
  }

  @Post('sources/:id/run')
  @Render('admin/sources')
  async run(@Param('id') id: string) {
    await this.adminService.runNow(id);
    return { sources: await this.adminService.listSources(), message: 'Crawl queued — check Crawl runs for progress' };
  }

  @Get('crawl-runs')
  @Render('admin/crawl-runs')
  async crawlRuns() {
    return { runs: await this.adminService.listCrawlRuns() };
  }
}
