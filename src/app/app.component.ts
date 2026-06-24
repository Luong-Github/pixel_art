import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHostComponent } from './core/notify/toast-host.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHostComponent],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <router-outlet />
    <app-toast-host />
  `,
})
export class AppComponent {}
