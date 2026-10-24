import { Controller, Get, Render, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller()
export class WebController {
  @Get()
  @Render('web/home')
  home(@Req() req: Request) {
    return { user: req.user ?? null };
  }
}
