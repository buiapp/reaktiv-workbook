import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, TemplateRef, afterRenderEffect, computed, effect, inject, input, output, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ViewZoomDirective } from '../view-zoom.directive';
import type { GraphLayout } from '../graph-layout';
import { GraphLevelScrollState, LEVEL_HEADER, graphLevels, projectGraphLevels, revealInLevel, type GraphConnections, type LevelPanel } from './graph-levels';

@Component({
  selector:'app-graph-levels',
  imports:[NgTemplateOutlet, ViewZoomDirective],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
    <div #viewport class="graph-scroll levels-viewport" [viewZoom]="zoom()" [viewZoomMin]="0.2" zoomContent=".graph-canvas" (viewZoomChange)="zoomChanged.emit($event)" (pointerdown)="pan($event)"
      [attr.data-fit-width]="projection().width" [attr.data-fit-height]="projection().height">
      @if (!layout().nodes.length) { <p class="empty" role="status">No cells match these filters. Turn off a filter to show more cells.</p> }
      <div class="graph-zoom-frame" [style.width.px]="projection().width*zoom()" [style.height.px]="projection().height*zoom()">
        <div class="graph-canvas levels-track" [class.focused]="focused()" [style.width.px]="projection().width" [style.height.px]="projection().height" [style.transform]="'scale('+zoom()+')'">
          <svg class="graph-edges levels-edges" [attr.width]="projection().width" [attr.height]="projection().height" aria-hidden="true">
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
            @for (edge of projection().edges; track edge.from+'-'+edge.to) {
              <ng-container *ngTemplateOutlet="edgeTemplate(); context:{$implicit:edge}" />
            }
          </svg>
          @for (level of projection().levels; track level.key) {
            <section class="graph-level" [attr.aria-label]="'Dependency level '+(level.index+1)" [style.left.px]="level.x" [style.top.px]="level.y" [style.width.px]="level.width" [style.height.px]="level.height">
              <header class="level-heading" [style.height.px]="headerHeight">
                <div><strong>Level {{level.index+1}}</strong><small>{{level.nodes.length}} cells</small></div>
                <div class="level-connections">
                  <button type="button" [disabled]="!level.before.length" [attr.aria-label]="level.before.length+' connected cells '+(projection().vertical?'left':'above')+' in level '+(level.index+1)" (click)="reveal(level, true)">{{projection().vertical ? '←' : '↑'}} {{level.before.length}} connected</button>
                  <button type="button" [disabled]="!level.after.length" [attr.aria-label]="level.after.length+' connected cells '+(projection().vertical?'right':'below')+' in level '+(level.index+1)" (click)="reveal(level, false)">{{level.after.length}} connected {{projection().vertical ? '→' : '↓'}}</button>
                </div>
              </header>
              <div #levelScroller class="level-scroller" tabindex="0" [attr.aria-label]="'Scroll dependency level '+(level.index+1)" [attr.data-level-key]="level.key"
                [class.vertical-flow]="projection().vertical" (scroll)="scrolled($event, level)"
                (pointerdown)="$event.stopPropagation()">
                <div class="level-content" [style.width.px]="level.scrollWidth" [style.height.px]="level.scrollHeight">
                  @for (node of level.nodes; track node.id) {
                    <ng-container *ngTemplateOutlet="nodeTemplate(); context:{$implicit:node,pane:nodeContext()}" />
                  }
                </div>
              </div>
            </section>
          }
        </div>
      </div>
    </div>
  `,
  styleUrl:'./graph-levels.component.scss',
})
export class GraphLevelsComponent {
  readonly layout=input.required<GraphLayout>();
  readonly state=input.required<GraphLevelScrollState>();
  readonly zoom=input(1);
  readonly selectedId=input('');
  readonly connections=input<GraphConnections>('selected');
  readonly focused=input(false);
  readonly nodeTemplate=input.required<TemplateRef<unknown>>();
  readonly edgeTemplate=input.required<TemplateRef<unknown>>();
  readonly nodeContext=input.required<unknown>();
  readonly zoomChanged=output<number>();
  readonly cellRequested=output<string>();
  readonly panRequested=output<{event:PointerEvent;viewport:HTMLElement}>();
  readonly headerHeight=LEVEL_HEADER;
  private readonly viewport=viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly scrollers=viewChildren<ElementRef<HTMLElement>>('levelScroller');
  private readonly dimensions=signal({width:800,height:500});
  private readonly levels=computed(()=>graphLevels(this.layout()));
  readonly projection=computed(()=>projectGraphLevels(this.levels(),this.layout(),this.dimensions(),this.zoom(),this.state().offsets(),this.connections(),this.selectedId()));
  private readonly pending=new Map<string,number>();
  private frame:number|null=null;
  private revealTarget:string|null=null;

  constructor() {
    const destroy=inject(DestroyRef);
    afterRenderEffect(onCleanup=>{
      const element=this.viewport()?.nativeElement;
      if (!element) return;
      const measure=()=>{
        const next={width:element.clientWidth,height:element.clientHeight}, current=this.dimensions();
        if (next.width>0&&next.height>0&&(next.width!==current.width||next.height!==current.height))this.dimensions.set(next);
      };
      measure();
      if (typeof ResizeObserver!=='undefined') {
        const observer=new ResizeObserver(measure);observer.observe(element);onCleanup(()=>observer.disconnect());
      }
    });
    // Selection/layout changes reveal the card. Manual scrolling never re-triggers it.
    effect(()=>{
      const id=this.selectedId(), direction=this.layout().direction ?? 'horizontal';
      untracked(()=>{
        const state=this.state();
        if (state.lastSelections.get(direction)===id)return;
        state.lastSelections.set(direction,id);this.revealTarget=id;this.revealCell(id);
      });
    });
    afterRenderEffect(()=>{
      const panels=new Map(this.projection().levels.map(panel=>[panel.key,panel]));
      for(const {nativeElement:element} of this.scrollers()) {
        const panel=panels.get(element.dataset['levelKey'] ?? '');
        if(!panel)continue;
        if(this.projection().vertical) {if(Math.abs(element.scrollLeft-panel.offset)>1)element.scrollLeft=panel.offset;}
        else if(Math.abs(element.scrollTop-panel.offset)>1)element.scrollTop=panel.offset;
      }
      if(this.revealTarget) {
        const id=this.revealTarget;this.revealTarget=null;
        const target=[...(this.viewport()?.nativeElement.querySelectorAll<HTMLElement>('.graph-node') ?? [])].find(node=>node.dataset['cellId']===id);
        target?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      }
    });
    destroy.onDestroy(()=>{if(this.frame!==null)cancelAnimationFrame(this.frame);});
  }
  pan(event:PointerEvent):void {
    if((event.target as HTMLElement).closest('.graph-level'))return;
    const viewport=this.viewport()?.nativeElement;
    if(viewport)this.panRequested.emit({event,viewport});
  }
  scrolled(event:Event,level:LevelPanel):void {
    const element=event.target as HTMLElement;
    this.pending.set(level.key,this.projection().vertical?element.scrollLeft:element.scrollTop);
    if(this.frame!==null)return;
    this.frame=requestAnimationFrame(()=>{
      this.frame=null;this.state().setOffsets(this.pending);this.pending.clear();
    });
  }
  reveal(level:LevelPanel,before:boolean):void {
    const ids=before?level.before:level.after, id=before?ids.at(-1):ids[0];
    if(!id)return;
    this.revealCell(id);this.cellRequested.emit(id);
  }
  private revealCell(id:string):void {
    const projection=this.projection(), panel=projection.levels.find(level=>level.nodes.some(node=>node.id===id));
    if(!panel)return;
    this.state().setOffsets(new Map([[panel.key,revealInLevel(panel,id,projection.vertical)]]));
  }
}
