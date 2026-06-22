import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SITE } from '../../core/seo/seo.data';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
})
export class ContactComponent {
  readonly email = 'hello@pixelartstudio.app';
  model = { name: '', email: '', message: '' };
  sent = false;

  /** No backend yet — open the user's mail client with a prefilled message. */
  submit(): void {
    const subject = encodeURIComponent(`Pixel Art Studio — message from ${this.model.name || 'a user'}`);
    const body = encodeURIComponent(`${this.model.message}\n\n— ${this.model.name} (${this.model.email})`);
    window.location.href = `mailto:${this.email}?subject=${subject}&body=${body}`;
    this.sent = true;
  }

  protected readonly site = SITE;
}
