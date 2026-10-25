import { Controller, Get, Post, Render, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { DataRightsService } from './data-rights.service';

@Controller()
@UseGuards(AuthenticatedGuard)
export class DataRightsController {
  constructor(private readonly dataRights: DataRightsService) {}

  @Get('account/export')
  async export(@CurrentUser() user: User, @Res() res: Response) {
    const data = await this.dataRights.exportAccount(user.id);
    res.setHeader('Content-Disposition', 'attachment; filename="job-copilot-export.json"');
    res.json(data);
  }

  @Post('account/delete')
  async delete(@CurrentUser() user: User, @Req() req: Request, @Res() res: Response) {
    await this.dataRights.deleteAccount(user.id);
    req.logout(() => undefined);
    req.session?.destroy(() => res.redirect('/'));
  }

  @Get('privacy')
  @Render('legal/privacy')
  privacy() {
    return {};
  }

  @Get('terms')
  @Render('legal/terms')
  terms() {
    return {};
  }
}
