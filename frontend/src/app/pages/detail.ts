import { Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { fmtKr, fmtNum, fmtScore, petClass, petSourceLabel, scoreColor } from '../format';
import { FloorPlanMeta, GalleryComponent } from '../components/gallery';
import { InfoButton } from '../components/info';
import { PetBadge } from '../components/pet-badge';
import { AD_STATUS_LABEL, AdStatusBadge } from '../components/ad-status-badge';
import { IssueTip } from '../components/issue-tip';
import { ISSUE_CLASS_LABEL } from '../issues';
import { SiteLogo } from '../components/site-logo';
import { ScoreTip } from '../components/score-tip';
import { HouseHome, HouseRoutes, HouseZone } from '../house/house-bubbles';
import { HouseTravelStore } from '../house/house-travel.store';
import { ZoneMinimap } from '../components/zone-minimap';
import { ValueScaleStore, valueOf } from '../value-scale';
import { HouseMap } from '../house/house-map';
import { CommuteRow, HouseLocation, Listing, ListingDetail } from '../models';
import { ApiService, apiError } from '../services/api.service';
import { CandidateOrderStore } from '../services/candidate-order.store';
import { SitesStore } from '../services/sites.store';
import { TagsStore } from '../services/tags.store';

@Component({
  selector: 'fh-detail',
  imports: [FormsModule, RouterLink, DatePipe, GalleryComponent, InfoButton, HouseHome, HouseZone, HouseRoutes, HouseMap, ScoreTip, ZoneMinimap, PetBadge, SiteLogo, AdStatusBadge, IssueTip],
  template: `
  <nav class="fh-detail-nav" aria-label="Candidates">
    @let n = nav();
    <a class="fh-btn-nav" [class.disabled]="!n?.prev" [attr.aria-disabled]="!n?.prev"
       [routerLink]="n?.prev ? ['/candidates', n!.prev] : null" title="Previous home in the candidates list (k)">
       <span class="fh-nav-arrow" aria-hidden="true">‹</span>Prev
       @if (n?.prev) { <span class="fh-nav-id">{{ n!.prev }}</span> }</a>
    <span class="fh-detail-pos">@if (n) { <b>{{ n.pos }}</b> / {{ n.total }} in the candidates list }</span>
    <a class="fh-btn-nav next" [class.disabled]="!n?.next" [attr.aria-disabled]="!n?.next"
       [routerLink]="n?.next ? ['/candidates', n!.next] : null" title="Next home in the candidates list (j)">
       @if (n?.next) { <span class="fh-nav-id">{{ n!.next }}</span> }Next
       <span class="fh-nav-arrow" aria-hidden="true">›</span></a>
  </nav>
  <div class="fh-page-head">
    <a routerLink="/candidates" class="fh-btn-nav"><span class="fh-nav-arrow" aria-hidden="true">←</span>Candidates</a>
    <h1 class="fh-mono">{{ shortId() }}</h1>
    @if (d(); as x) {
      @if (x.issues?.length) { <fh-issue-tip mode="icon" [issues]="x.issues!" /> }
      <fh-pet-badge prefix="pets " [status]="x.listing.pet_status" [source]="x.listing.pet_source" [evidence]="x.listing.pet_evidence" />
      @if (x.listing.origin_site) { <fh-site-logo [slug]="x.listing.origin_site" [withName]="true" [title]="'First published on ' + sites.name(x.listing.origin_site)" /> }
      <select class="form-select form-select-sm fh-status-select" title="Status" aria-label="Status" [ngModel]="x.listing.status" (ngModelChange)="setStatus($event)">
        @for (s of tags.statuses(); track s) { <option [value]="s">{{ tags.statusLabel(s) }}</option> }
      </select>
      @if (x.listing.canonical_url) { <a class="fh-btn-glow" [href]="x.listing.canonical_url" target="_blank" rel="noopener">Open on site ↗</a> }
    }
  </div>
  @if (error()) { <div class="alert alert-danger py-1 small" style="white-space:pre-wrap">{{ error() }}</div> }
  @if (info()) { <div class="alert alert-info py-1 small">{{ info() }}</div> }

  @if (d(); as x) {
    <div class="row g-3">
      <div class="col-lg-7">
        <fh-gallery [photos]="x.listing.photo_urls" [plans]="x.listing.floorplan_urls" [plansMeta]="planMeta(x.listing)"
          [link]="x.listing.canonical_url" [incomplete]="galleryIncomplete(x.listing)" [band]="true" />

        @let L = x.listing;
        <section class="fh-hcard fh-hcard-main">
          <header><h2>{{ L.title || L.address_raw }}</h2><span class="fh-hsub">{{ L.area }}{{ L.title && L.address_raw ? ' · ' + L.address_raw : '' }}</span></header>
          @let rr = values.rate(L, 'rent_sek'); @let rm = values.rate(L, 'rent_per_m2');
          @let ro = values.rate(L, 'rooms_rok'); @let rs = values.rate(L, 'size_m2');
          <div class="fh-facts">
            @let vRent = kr(L.rent_sek); @let vM2 = kr(perM2(L)); @let vRooms = num(L.rooms_rok) + ' rok'; @let vSize = num(L.size_m2, ' m²');
            @let vFloor = '' + (L.floor ?? '?'); @let vType = L.contract_type ? L.contract_type.replace('_', '-') : '?';
            @let vEnd = L.contract_end ? '→ ' + (L.contract_end | date: 'd MMM y') : '';
            @let vMove = L.available_from ? (L.available_from | date: 'd MMM y') ?? '?' : '?';
            <div class="fh-fact" [style.--c]="rr?.colour" [title]="rr?.title ?? ''"><span class="fh-fact-l">Rent</span>
              <span class="fh-fact-v" [style.--len]="vRent.length">{{ vRent }}</span><span class="fh-fact-n">per month</span></div>
            <div class="fh-fact" [style.--c]="rm?.colour" [title]="rm?.title ?? ''"><span class="fh-fact-l">Per m²</span>
              <span class="fh-fact-v" [style.--len]="vM2.length">{{ vM2 }}</span><span class="fh-fact-n">per month</span></div>
            <div class="fh-fact" [style.--c]="ro?.colour" [title]="ro?.title ?? ''"><span class="fh-fact-l">Rooms</span>
              <span class="fh-fact-v" [style.--len]="vRooms.length">{{ vRooms }}</span><span class="fh-fact-n">{{ L.has_sovalkov ? '+ sovalkov' : '\u00a0' }}</span></div>
            <div class="fh-fact" [style.--c]="rs?.colour" [title]="rs?.title ?? ''"><span class="fh-fact-l">Size</span>
              <span class="fh-fact-v" [style.--len]="vSize.length">{{ vSize }}</span><span class="fh-fact-n">&nbsp;</span></div>
            <div class="fh-fact"><span class="fh-fact-l">Floor</span>
              <span class="fh-fact-v" [style.--len]="vFloor.length">{{ vFloor }}</span><span class="fh-fact-n">{{ L.build_year ? 'built ' + L.build_year : '\u00a0' }}</span></div>
            <div class="fh-fact" [title]="L.contract_end ? 'Fixed term, until ' + (L.contract_end | date: 'd MMMM y') : ''"><span class="fh-fact-l">Contract</span>
              <span class="fh-fact-v" [style.--len]="vType.length">{{ vType }}</span>
              <span class="fh-fact-n" [class.fh-fact-end]="!!vEnd" [style.--len]="vEnd.length">{{ vEnd || '\u00a0' }}</span></div>
            @let mv = values.moveIn(L);
            <div class="fh-fact" [style.--c]="mv?.colour" [title]="mv?.title ?? ''"><span class="fh-fact-l">Move in</span>
              <span class="fh-fact-v" [style.--len]="vMove.length">{{ vMove }}</span><span class="fh-fact-n">&nbsp;</span></div>
          </div>
          <div class="fh-feats">
            @for (f of features(L); track f.label) {
              <span class="fh-feat" [class.yes]="f.v === true" [class.no]="f.v === false">{{ f.v === true ? '✓' : f.v === false ? '✕' : '?' }} {{ f.label }}</span>
            }
          </div>
          @if (L.description_excerpt) {
            <button type="button" class="fh-desc-tg" [attr.aria-expanded]="descOpen()" (click)="descOpen.set(!descOpen())"
              [title]="descOpen() ? 'Fold the description away' : 'Show the description from the ad'">
              <i aria-hidden="true">{{ descOpen() ? '▾' : '▸' }}</i> Description
              @if (!descOpen()) { <span class="fh-desc-peek">{{ L.description_excerpt }}</span> }</button>
            @if (descOpen()) { <p class="fh-desc-text">{{ L.description_excerpt }}</p> }
          }
        </section>

        @if (x.issues?.length) {
          <section class="fh-hcard fh-issues-card">
            <header><h2>Issues</h2><span class="fh-hsub">{{ x.issues!.length }} issue{{ x.issues!.length === 1 ? '' : 's' }}</span>
              <button type="button" class="fh-btn-glow ms-auto" [disabled]="detailsBusy()" (click)="completeDetails(x)"
                      title="Read this listing's page again (the details job, for this listing only)">Complete details</button></header>
            @for (i of x.issues!; track i.code) {
              <div class="fh-issue-row"><span class="fh-issue-trigger" aria-hidden="true">⚠</span>
                <div><b>{{ i.label }}</b> <span class="fh-issue-cls" [class.check]="i.cls === 'check_extraction'" [class.attn]="i.cls === 'attention'">{{ issueCls[i.cls] }}</span>
                  @if (i.detail) { <span class="fh-issue-detail">{{ i.detail }}</span> }
                  <div class="text-body-secondary small">{{ i.hint }}</div></div></div>
            }
          </section>
        }

        @if (terms(L); as t) {
          <section class="fh-hcard">
            <header><h2>Contract and conditions</h2><span class="fh-hsub">as the ad states them · not scored</span></header>
            @if (t.contract.length) {
              <div class="fh-hlabel">Contract</div>
              <div class="fh-chips">@for (c of t.contract; track c.label) { <span class="fh-chipf t-contract sel" [title]="c.raw ?? ''">{{ c.label }}</span> }</div>
            }
            @if (t.requirements.length) {
              <div class="fh-hlabel">Requirements</div>
              <div class="fh-chips">@for (c of t.requirements; track c) { <span class="fh-chipf sel">{{ c }}</span> }</div>
            }
            @if (t.utilities.length) {
              <div class="fh-hlabel">Included and metered</div>
              <div class="fh-chips">@for (c of t.utilities; track c) { <span class="fh-chipf">{{ c }}</span> }</div>
            }
            @if (t.amenities.length) {
              <div class="fh-hlabel">Amenities</div>
              <div class="fh-chips">@for (c of t.amenities; track c) { <span class="fh-chipf">{{ c }}</span> }</div>
            }
          </section>
        }

        @if (L.lat != null && L.lon != null) {
          <fh-house-map [lat]="L.lat" [lon]="L.lon" [shortId]="L.short_id" [loc]="loc()" [outside]="outside()" />
        }
        @if (loc(); as l) {
          <div class="row g-3">
            <div class="col-xl-6"><fh-house-home [loc]="l" [transit]="travel.results()[l.listing.short_id] ?? null" /></div>
            <div class="col-xl-6"><fh-house-zone [loc]="l" /></div>
          </div>
        } @else if (locError() && !outside()) {
          <div class="fh-hcard"><div class="fh-hnote">House analysis not available: {{ locError() }}</div></div>
        } @else if (!locError()) {
          <div class="fh-hcard"><div class="fh-hnote">Measuring the home from its address… (a few seconds the first time)</div></div>
        }

        <section class="fh-hcard">
          <header><h2>Commute</h2><span class="fh-hsub">{{ x.commute.length ? x.commute.length + ' trips' : 'not computed' }}</span><fh-info id="listing.commute" /></header>
          <div class="d-flex flex-wrap gap-2 mb-2">
            <button type="button" class="fh-btn-ghost" (click)="commute(true)" title="Count the calls, without calling">Dry run</button>
            <button type="button" class="fh-btn-glow" [disabled]="commuteBusy()" (click)="computeCommute(x.listing)">Compute</button>
          </div>
          @if (commuteAsk(); as a) {
            <div class="alert alert-warning py-2 small mb-2">
              This home is outside the analysed zones, so there is no free estimate: computing its commute asks
              <b>{{ a.calls }} ResRobot call{{ a.calls === 1 ? '' : 's' }}</b> ({{ a.requests }} requests, {{ a.cached }} cached{{ a.estimated ? ', ' + a.estimated + ' estimated' : '' }}).
              <div class="d-flex gap-2 mt-2">
                <button type="button" class="fh-btn-glow t-warn" (click)="commuteAsk.set(null); commute(false)">Proceed ({{ a.calls }} call{{ a.calls === 1 ? '' : 's' }})</button>
                <button type="button" class="fh-btn-ghost" (click)="commuteAsk.set(null); info.set('')">Cancel</button>
              </div>
            </div>
          }
          @if (!x.commute.length) { <div class="fh-hnote">Not computed for this config yet.</div> }
          @else {
            <div class="table-responsive"><table class="fh-ctable">
              <thead><tr><th>Point</th><th></th><th>Window</th><th>Day</th><th>Mode</th><th>Median</th><th>p90</th><th>Worst</th><th>Source</th></tr></thead>
              <tbody>
              @for (c of x.commute; track $index) {
                <tr>
                  <td>{{ c.point_id }}</td><td>{{ c.direction === 'to_point' ? '→' : '←' }}</td><td>{{ c.window_label }}</td>
                  <td>{{ c.day_type }}</td><td>{{ c.mode }}</td>
                  <td class="fh-cmed">{{ min(c.median_min) }}</td><td [class.text-warning]="spread(c)" [title]="spread(c) ? 'The times spread over more than 10 minutes' : ''">{{ min(c.p90_min) }}</td><td>{{ min(c.worst_min) }}</td>
                  <td class="text-body-secondary">{{ c.provider === 'haversine' ? 'estimate' : c.provider }}</td>
                </tr>
              }
              </tbody>
            </table></div>
          }
        </section>

        @for (e of x.evaluations.slice(0, 1); track e.at) {
          <section class="fh-hcard fh-hcard-main">
            <header><h2>Agent evaluation</h2><span class="fh-hsub">{{ e.at | date: 'short' }}</span></header>
            <p class="small mb-2">{{ e.summary }}</p>
            @if (e.pros.length) { <div class="fh-hlabel">Pros</div><ul class="fh-evlist pro">@for (t of e.pros; track $index) { <li>{{ t }}</li> }</ul> }
            @if (e.cons.length) { <div class="fh-hlabel">Cons</div><ul class="fh-evlist con">@for (t of e.cons; track $index) { <li>{{ t }}</li> }</ul> }
            @if (e.questions_for_landlord.length) { <div class="fh-hlabel">Ask the landlord</div>
              <ul class="fh-evlist ask">@for (t of e.questions_for_landlord; track $index) { <li>{{ t }}</li> }</ul> }
          </section>
        }
      </div>

      <div class="col-lg-5">
        <div class="fh-hcard">
          <header><h2>Where</h2><span class="fh-hsub">{{ x.listing.area }}</span><fh-info id="listing.where" /></header>
          <fh-zone-minimap [lat]="x.listing.lat" [lon]="x.listing.lon" [zoneId]="x.listing.zone_id" [zoneName]="x.listing.zone_name" [height]="260"
            [interactive]="true" />
        </div>
        <section class="fh-hcard" [class.collapsed]="!scoreOpen()">
          <header><h2><button type="button" class="fh-hcard-tg" [attr.aria-expanded]="scoreOpen()" (click)="scoreOpen.set(!scoreOpen())">Score</button></h2>
            <fh-score-tip [total]="x.score?.total" [breakdown]="x.score?.breakdown" [rejected]="x.score?.rejected_by" />
            <fh-info id="score.total" />
          </header>
          @if (scoreOpen()) {
          @if (x.score_stale) { <div class="small text-warning mb-1">No score for the current config. <a href="" (click)="$event.preventDefault(); recompute()">Recompute</a></div> }
          @if (x.score?.rejected_by?.length) {
            <div class="fh-chips mb-2">@for (r of x.score!.rejected_by; track r) { <span class="fh-chipf t-no sel" title="Rejected by this hard filter">✕ {{ r }}</span> }</div>
          }
          @for (g of breakdown(); track g.name) {
            <div class="fh-sbar">
              <span class="fh-sbar-n">{{ g.name }} <span class="text-body-secondary">×{{ g.weight }}</span>
                <fh-info [id]="'score.' + g.name" [quiet]="true" [derivation]="g.detail ?? null" />
                @if (g.estimated) { <span class="fh-badge-est" title="Part of this value is estimated (Connectivity minutes): compute the transit routes to your points to make it exact">estimate</span> }</span>
              <span class="fh-sbar-t" [title]="g.why"><i [style.width.%]="(g.score ?? 0) * 100" [style.--c]="color(g.score)"></i></span>
              <span class="fh-sbar-v" [title]="g.why" [style.color]="color(g.score)">{{ g.score == null ? 'n/a' : score(g.score) }}@if (g.estimated) { <i class="fh-est-dot inline"></i> }</span>
            </div>
          }
          }
        </section>

        <section class="fh-hcard" [class.fh-hcard-main]="x.listing.pet_status === 'conflict'">
          <header><h2>Pets</h2>
            <fh-pet-badge [status]="x.listing.pet_status" [source]="x.listing.pet_source" [evidence]="x.listing.pet_evidence" />
            <span class="fh-hsub">{{ x.listing.pet_source ? 'set by ' + petSource(x.listing.pet_source) : 'nobody has decided yet' }}</span>
          </header>
          @if (x.listing.pet_status === 'conflict') {
            <div class="small text-warning-emphasis mb-2">The sources disagree: your answer settles it.</div>
          }
          @if (x.listing.pet_evidence) { <p class="fh-desc-text mt-0 mb-2">“{{ x.listing.pet_evidence }}”</p> }
          <div class="fh-hlabel">Your answer</div>
          <div class="fh-chips">
            @for (p of petAnswers; track p) {
              <button type="button" class="fh-chipf" [class]="'fh-chipf t-' + p" [class.sel]="x.listing.pet_source === 'user' && x.listing.pet_status === p"
                [attr.aria-pressed]="x.listing.pet_source === 'user' && x.listing.pet_status === p" [disabled]="petBusy()" (click)="setPet(p)">
                <i class="fh-chipf-dot"></i>{{ p }}</button>
            }
            @if (x.listing.pet_source === 'user') {
              <button type="button" class="btn btn-link btn-sm p-0 ms-1" [disabled]="petBusy()" (click)="setPet('unknown')" title="Forget your answer: the agent, the site and the rules decide again">clear</button>
            }
          </div>
          <input class="form-control form-control-sm mt-2" placeholder="note, e.g. what the landlord said (optional)" [(ngModel)]="petNote" title="Saved with the answer you click" />
        </section>

        <section class="fh-hcard fh-hcard-main">
          <header><h2>Feedback</h2><span class="fh-hsub">{{ x.feedback.length ? x.feedback.length + ' saved' : 'tell the search what you think' }}</span></header>
          <div class="fh-chips">
            @for (p of polarities; track p) {
              <button type="button" [class]="'fh-chipf ' + polarityTone(p)" [class.sel]="polarity === p" [attr.aria-pressed]="polarity === p" (click)="polarity = p">
                <i class="fh-chipf-dot"></i>{{ p }}</button>
            }
          </div>
          <div class="fh-hlabel">{{ polarity === 'dislike' ? 'What is wrong' : 'What is good' }}</div>
          <div class="fh-chips mt-0">
            @for (t of (polarity === 'dislike' ? tags.negative() : tags.positive()); track t.key) {
              <button type="button" [class]="'fh-chipf ' + (polarity === 'dislike' ? 't-no' : 't-violet')" [class.sel]="picked.has(t.key)"
                [attr.aria-pressed]="picked.has(t.key)" (click)="toggle(t.key)">{{ t.label }}</button>
            }
          </div>
          <textarea class="form-control form-control-sm mt-2" rows="2" placeholder="note (optional)" [(ngModel)]="note"></textarea>
          <div class="d-flex mt-2"><button type="button" class="fh-btn-glow ms-auto" (click)="sendFeedback()">Save feedback</button></div>
          @if (x.feedback.length) {
            <div class="fh-hlabel">Saved</div>
            @for (f of x.feedback; track f.at) {
              <div class="fh-fb-row">
                <span [class]="'fh-chipf sel ' + polarityTone(f.polarity)"><i class="fh-chipf-dot"></i>{{ f.polarity }}</span>
                @for (t of f.tags; track t) { <span class="fh-chipf" [class.t-no]="f.polarity === 'dislike'">{{ t }}</span> }
                @if (f.note) { <span>{{ f.note }}</span> }
                <span class="fh-fb-at">{{ f.at | date: 'short' }}</span>
              </div>
            }
          }
        </section>

        @if (loc(); as l) { <fh-house-routes [loc]="l" /> }

        <section class="fh-hcard" [class.collapsed]="!digestOpen()">
          <header><h2><button type="button" class="fh-hcard-tg" [attr.aria-expanded]="digestOpen()" (click)="digestOpen.set(!digestOpen())">Digest for agents</button></h2>
            <button type="button" class="fh-chipf ms-auto" (click)="copy()" title="Copy the digest to paste it to an agent">copy</button></header>
          @if (digestOpen()) { <pre class="fh-pre fh-mono mt-2 mb-0">{{ digest() }}</pre> }
        </section>

        <section class="fh-hcard small">
          <header><h2>Sources & timeline</h2><span class="fh-hsub">{{ x.sources.length }} source{{ x.sources.length === 1 ? '' : 's' }}</span></header>
          @if (x.listing.origin_site; as o) {
            <div class="d-flex align-items-center gap-2 mb-2">
              <fh-site-logo [slug]="o" size="md" />
              <div><div class="fw-semibold">{{ sites.name(o) }}</div><div class="text-body-secondary" style="font-size:0.74rem">first published here (origin)</div></div>
            </div>
          }
          @for (s of x.sources; track s.site_slug + s.external_id) {
            <div class="fh-src-row">
              <fh-site-logo [slug]="s.site_slug" />
              <span class="text-truncate">{{ sites.name(s.site_slug) }} ·
                @if (s.url) { <a [href]="s.url" target="_blank" rel="noopener" class="fh-mono">{{ s.external_id }} ↗</a> } @else { <span class="fh-mono">{{ s.external_id }}</span> }
                <span class="fh-chipf t-contract ms-1" style="font-size:.66rem; padding:0 7px">{{ s.source_method === 'agent_browser' ? 'browser' : s.source_method }}</span>
                @if (s.first_scan_run_id || s.scan_run_id) {
                  <a class="ms-1" style="font-size:0.74rem" [routerLink]="['/runs']" [queryParams]="{ scan: s.first_scan_run_id || s.scan_run_id }"
                     title="The scan run that found this source">run ↗</a>
                }
                <fh-ad-status class="ms-1" [status]="s.ad_status" [site]="sites.name(s.site_slug)" [checkedAt]="s.status_checked_at" [evidence]="s.status_evidence" /></span>
              <span class="text-body-secondary text-end" style="font-size:0.74rem" [title]="'first seen ' + (s.first_seen_at | date: 'medium') + ', last seen ' + (s.last_seen_at | date: 'medium')">
                {{ s.first_seen_at | date: 'shortDate' }}{{ (s.last_seen_at | date: 'shortDate') !== (s.first_seen_at | date: 'shortDate') ? ' → ' + (s.last_seen_at | date: 'shortDate') : '' }}</span>
            </div>
          }
          @if (x.ad_status_events?.length) {
            <div class="fh-hlabel">Ad status history</div>
            <ul class="fh-tl">
              @for (e of x.ad_status_events!.slice(0, 8); track e.at + e.site_slug) {
                <li [title]="adEvidence(e.evidence)"><b>{{ sites.name(e.site_slug) }}: {{ adLabel(e.from_status) }} → {{ adLabel(e.to_status) }}</b>
                  <span class="text-body-secondary ms-1">by {{ e.actor === 'job' ? 'status check' : e.actor }}</span>
                  <div class="fh-tl-at">{{ e.at | date: 'medium' }}</div></li>
              }
            </ul>
          }
          @if (x.events.length) {
            <div class="fh-hlabel">Timeline</div>
            <ul class="fh-tl">
              @for (e of x.events; track e.at) {
                <li><b>{{ e.from_status ?? 'found' }} → {{ e.to_status }}</b><span class="text-body-secondary ms-1">by {{ e.actor }}</span>
                  @if (e.note) { · {{ e.note }} }<div class="fh-tl-at">{{ e.at | date: 'medium' }}</div></li>
              }
            </ul>
          }
        </section>
      </div>
    </div>
  }
  `,
})
export class DetailPage {
  readonly shortId = input.required<string>();
  protected issueCls = ISSUE_CLASS_LABEL;
  protected detailsBusy = signal(false);
  /** Read this listing's page again: the agent details job for browser sites, the in-app one for scripted sites. */
  protected completeDetails(x: ListingDetail): void {
    const browser = x.sources.some((s) => s.source_method === 'agent_browser');
    const key = browser ? 'listing_details' : 'listing_details_script';
    this.detailsBusy.set(true);
    this.api.runJob(key, { n: 1, subset: { short_ids: [x.listing.short_id] } }).subscribe({
      next: () => { this.detailsBusy.set(false); this.info.set(browser
        ? 'The details job is reading this listing in your Chrome: follow it on the Jobs page.'
        : 'Reading this listing\'s page again in the background: reload in a few seconds.'); },
      error: (e) => { this.detailsBusy.set(false); this.error.set(apiError(e)); },
    });
  }
  /** The display-only terms (attributes.contract_terms, requirements, utilities, amenities); null when there are none. */
  protected terms(L: Listing): { contract: { label: string; raw?: string | null }[]; requirements: string[]; utilities: string[]; amenities: string[] } | null {
    const a = (L.attributes ?? {}) as Record<string, any>;
    const ct = a['contract_terms'] ?? {}, rq = a['requirements'] ?? {};
    const mo = (n: number) => `${n} month${n === 1 ? '' : 's'}`;
    const contract = [
      ct.short_term ? { label: 'Short-term contract', raw: null } : null,
      ct.guaranteed_months != null || ct.guaranteed_raw ? { label: `Guaranteed ${ct.guaranteed_months != null ? mo(ct.guaranteed_months) : '(see wording)'}`, raw: ct.guaranteed_raw } : null,
      ct.estimated_months != null || ct.estimated_raw ? { label: `Estimated ${ct.estimated_months != null ? mo(ct.estimated_months) : '(see wording)'}`, raw: ct.estimated_raw } : null,
      ct.notice_months != null || ct.notice_raw ? { label: `Notice ${ct.notice_months != null ? mo(ct.notice_months) : '(see wording)'}`, raw: ct.notice_raw } : null,
      ct.extension_raw ? { label: ct.max_total_months ? `Extension, max ${mo(ct.max_total_months)}` : 'Extension (see wording)', raw: ct.extension_raw } : null,
    ].filter((c): c is { label: string; raw: string | null } => !!c);
    const requirements = [
      rq.min_income_sek != null ? `Income ≥ ${fmtKr(rq.min_income_sek)}` : '',
      rq.residual_income_sek != null ? `Left after rent ≥ ${fmtKr(rq.residual_income_sek)} (one adult)` : '',
      rq.residual_income_couple_sek != null ? `Left after rent ≥ ${fmtKr(rq.residual_income_couple_sek)} (couple)` : '',
      rq.max_household != null ? `At most ${rq.max_household} people` : '',
      ...(rq.raw ?? []),
    ].filter(Boolean);
    const utilities: string[] = a['utilities'] ?? [], amenities: string[] = a['amenities'] ?? [];
    return contract.length || requirements.length || utilities.length || amenities.length ? { contract, requirements, utilities, amenities } : null;
  }
  protected adLabel(s: string | null | undefined): string { return s ? AD_STATUS_LABEL[s as keyof typeof AD_STATUS_LABEL] ?? s : 'new'; }
  protected adEvidence(ev: Record<string, unknown> | null | undefined): string {
    return ev?.['rule'] ? `${ev['rule']}${ev['value'] ? ': ' + ev['value'] : ''}` : '';
  }
  private api = inject(ApiService);
  private router = inject(Router);
  private order = inject(CandidateOrderStore);
  /** Previous and next home of the candidates list, and this one's position in it. */
  protected nav = computed(() => this.order.around(this.shortId()));
  /** The score card shows only the total until opened. */
  protected scoreOpen = signal(false);
  /** The agent digest folds to its header (copy still works). */
  protected digestOpen = signal(false);
  /** The ad's description: folded to one line until opened (kept while moving between homes). */
  protected descOpen = signal(false);
  protected polarityTone = (p: string) => (p === 'like' ? 't-yes' : p === 'dislike' ? 't-no' : 't-unknown');
  protected tags = inject(TagsStore);
  protected sites = inject(SitesStore);
  protected petAnswers = ['yes', 'no', 'ask'] as const;
  protected petNote = '';
  protected petBusy = signal(false);
  protected petSource = petSourceLabel;
  protected d = signal<ListingDetail | null>(null);
  protected loc = signal<HouseLocation | null>(null);
  protected locError = signal('');
  /** The house analysis answered that the home is outside every mapped zone (the map still shows its position). */
  protected outside = computed(() => /outside every zone/.test(this.locError()));
  protected travel = inject(HouseTravelStore);
  protected values = inject(ValueScaleStore);
  /** The dry run's counts, waiting for "Proceed" (homes outside the analysed zones). */
  protected commuteAsk = signal<{ calls: number; requests: number; cached: number; estimated: number } | null>(null);
  protected commuteBusy = signal(false);
  protected digest = signal('');
  protected error = signal('');
  protected info = signal('');
  protected polarities = ['like', 'dislike', 'neutral'] as const;
  protected polarity: 'like' | 'dislike' | 'neutral' = 'like';
  protected picked = new Set<string>();
  protected note = '';
  protected kr = fmtKr; protected num = fmtNum; protected score = fmtScore; protected pet = petClass; protected color = scoreColor;
  protected breakdown = computed(() =>
    Object.entries(this.d()?.score?.breakdown ?? {}).map(([name, v]) => ({ name, ...v })));

  constructor() {
    // only the id drives a reload: load() reads other signals (loc), which must not re-trigger this effect
    effect(() => { const id = this.shortId(); untracked(() => this.load(id)); });
    this.values.load();
    this.sites.load();
  }

  load(id: string): void {
    this.order.ensure(id);
    this.commuteAsk.set(null);
    this.api.listing(id).subscribe({ next: (x) => { this.d.set(x); this.error.set(''); }, error: (e) => this.error.set(apiError(e)) });
    if (this.loc()?.listing.short_id !== id) { this.loc.set(null); this.locError.set(''); }
    this.api.listingLocation(id).subscribe({ next: (l) => this.loc.set(l), error: (e) => this.locError.set(apiError(e)) });
    this.api.digest(id, true).subscribe({ next: (t) => this.digest.set(t), error: () => {} });
  }
  /** Scans before the full-gallery fix kept 6 photos and no photo_count: the next browser scan fills them in. */
  galleryIncomplete(l: Listing): boolean { return l.photo_urls.length === 6 && l.attributes?.['photo_count'] == null; }
  /** Each floor plan's kind and cached preview (attributes.floorplans), so the gallery shows PDFs and viewer pages. */
  planMeta(l: Listing): FloorPlanMeta[] { const v = l.attributes?.['floorplans']; return Array.isArray(v) ? (v as FloorPlanMeta[]) : []; }
  protected perM2 = (l: Listing) => valueOf(l, 'rent_per_m2');
  /** Yes / no / unknown features, shown as ✓ / ✕ / ? chips. */
  protected features(l: Listing): { label: string; v: boolean | null }[] {
    return [{ label: 'lift', v: l.has_elevator ?? null }, { label: 'balcony', v: l.has_balcony ?? null },
      ...(l.has_sovalkov ? [{ label: 'sovalkov', v: true }] : [])];
  }

  /** j / k: next / previous home of the candidates list (not while typing, nor in the photo viewer). */
  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || document.querySelector('.fh-gal-viewer')) return;
    const to = ev.key === 'j' ? this.nav()?.next : ev.key === 'k' ? this.nav()?.prev : null;
    if (to) { ev.preventDefault(); this.router.navigate(['/candidates', to]); }
  }
  min(v: number | null): string { return v == null ? '–' : `${Math.round(v)}′`; }
  spread(c: CommuteRow): boolean { return (c.spread_min ?? 0) > 10; }
  toggle(k: string): void { this.picked.has(k) ? this.picked.delete(k) : this.picked.add(k); }

  setStatus(status: string): void {
    this.api.setStatus(this.shortId(), status).subscribe({
      next: (r) => { this.info.set(`${r.from} → ${r.to}`); this.load(this.shortId()); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  sendFeedback(): void {
    this.api.feedback(this.shortId(), this.polarity, [...this.picked], this.note || undefined).subscribe({
      next: () => { this.picked.clear(); this.note = ''; this.info.set('Feedback saved'); this.load(this.shortId()); },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  /** Compute: a home outside the analysed zones first counts the calls (dry run) and asks before spending them. */
  computeCommute(l: Listing): void {
    if (l.zone_id || this.commuteAsk()) { this.commuteAsk.set(null); this.commute(false); return; }
    this.commuteBusy.set(true);
    this.info.set('Counting calls before computing (outside the analysed zones)…');
    this.api.computeCommute([this.shortId()], true).subscribe({
      next: (r) => {
        this.commuteBusy.set(false);
        const res: any = Object.values(r.results)[0] ?? {};
        if (res.error) { this.info.set(res.error); return; }
        this.info.set('');
        if (!res.calls) { this.commute(false); return; }                 // everything cached: nothing to ask
        this.commuteAsk.set({ calls: res.calls, requests: res.requests, cached: res.cached, estimated: res.estimated });
      },
      error: (e) => { this.commuteBusy.set(false); this.error.set(apiError(e)); },
    });
  }

  commute(dry: boolean): void {
    this.info.set(dry ? 'Counting calls…' : 'Computing commute…');
    this.api.computeCommute([this.shortId()], dry).subscribe({
      next: (r) => {
        const res = Object.values(r.results)[0] ?? {};
        this.info.set(res.error ? res.error : `${res.requests} requests · ${res.cached} cached · ${res.calls} ${dry ? 'would call' : 'calls'} · ${res.estimated} estimated`
          + (res.missing_coords?.length ? ` · no coordinates for ${res.missing_coords.join(', ')}` : ''));
        if (!dry) this.api.recompute([this.shortId()]).subscribe(() => this.load(this.shortId()));
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }
  /** Your answer on the pets (wins over every other source); 'unknown' clears it. */
  setPet(status: 'yes' | 'no' | 'ask' | 'unknown'): void {
    this.petBusy.set(true);
    this.api.setPet(this.shortId(), status, this.petNote || undefined).subscribe({
      next: () => {
        this.petBusy.set(false);
        this.info.set(status === 'unknown' ? 'Your pet answer is cleared' : `Pets: ${status} (your answer)`);
        this.petNote = '';
        this.load(this.shortId());
      },
      error: (e) => { this.petBusy.set(false); this.error.set(apiError(e)); },
    });
  }
  recompute(): void { this.api.recompute([this.shortId()]).subscribe(() => this.load(this.shortId())); }
  copy(): void { navigator.clipboard?.writeText(this.digest()).then(() => this.info.set('Digest copied')); }
}
