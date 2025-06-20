import Snap from 'snapsvg-cjs';

import {
  sentenceConllToJson,
  sentenceJsonToConll,
  emptyTreeJson,
  returnTokensInOrder,
  getNodeFromTreeJson,
} from 'conllup/lib/conll';
import { treeJson_T, tokenJson_T, metaJson_T } from 'conllup/lib/conll';

import { EventDispatcher } from './EventDispatcher';
import { ReactiveSentence } from './ReactiveSentence';

//////    CONSTANT DECLARATION    //////
const SVG_CONFIG = {
  startTextY: 10,
  textgraphdistance: 10,
  dragclickthreshold: 400, // ms
  arrowheadsize: 5,
  gapX: 18,
  sizeFontY: 18,
  reverseArcThreshold: 20, // pixels below tokens mouth need to be to reverse the arc
};

const ROOT_ID_IN_SVG = -1;
// const dragclickthreshold = 400; //ms

interface Box {
  width:  number;
  height: number;
  x:      number;
  y:      number;
}

///////////////                ////////////////
///////////////   SentenceSVG  ////////////////
///////////////                ////////////////
export interface SentenceSVGOptions {
  // drawEnhancedRelations: boolean; // TODO
  drawEnhancedTokens: boolean;
  drawGroupTokens: boolean;
  shownFeatures: string[];
  interactive: boolean;
  matches: string[];
  packages: {
    modified_edges: {
      src: string;
      edge: string;
      tar: string;
    }[];
    modified_nodes: {
      id: string;
      features: string[];
    }[];
  } | null;
  tokenSpacing: number;
  featuresHorizontalSpacing: number;
  arcHeight: number;
}

export const defaultSentenceSVGOptions = (): SentenceSVGOptions => ({
  // drawEnhancedRelations: false, // TODO
  drawEnhancedTokens: false,
  drawGroupTokens: false,
  shownFeatures: [],
  interactive: false,
  matches: [],
  packages: null,
  tokenSpacing: 40,
  featuresHorizontalSpacing: 20,
  arcHeight: 60,
});

export class SentenceSVG extends EventDispatcher {
  // export class SentenceSVG {
  snapSentence: Snap.Paper;
  treeJson: treeJson_T;
  metaJson: metaJson_T;
  teacherTreeJson: treeJson_T = emptyTreeJson();
  shownFeatures: string[] = [];
  // matchnodes: Array<string>;
  // matchedges: string[];
  tokenSVGs: TokenSVG[] = [];
  dragged: string = '';
  hovered: string = '';
  totalWidth = 0;
  totalHeight = 0;
  levelsArray: number[] = [];
  orderOfTokens: string[] = [];
  tokenIndexToSvgPosition: { [key: string]: number } = {};
  options: SentenceSVGOptions = defaultSentenceSVGOptions();
  presetLocations: { [key: string]: Box } = {};

  constructor(svgWrapper: SVGElement, reactiveSentence: ReactiveSentence, sentenceSVGOptions: SentenceSVGOptions) {
    super();
    this.snapSentence = Snap(svgWrapper);
    this.treeJson = reactiveSentence.state.treeJson;
    this.metaJson = reactiveSentence.state.metaJson;
    Object.assign(this.options, sentenceSVGOptions);

    reactiveSentence.attach(this);

    if (this.options.shownFeatures.length === 0) {
      this.options.shownFeatures = reactiveSentence.getAllFeaturesSet();
    }

    // // put FORM at the beginning of the shownFeatures array
    this.options.shownFeatures = this.options.shownFeatures.filter((item) => item !== 'FORM');
    this.options.shownFeatures.unshift('FORM');
    this.drawTree();
  }

  drawTree() {
    this.clearTree();
    this.populateOrderOfTokens();
    this.populateLevels();
    this.populateTokenSVGs();
    this.drawRelations();
    this.drawEnhancedRelations();
    this.adaptSvgCanvas();
    this.showhighlights();

    if (this.options.matches.length > 0) {
      this.showmatches();
    }

    if (this.options.packages !== null) {
      this.showpackages();
    }

    if (this.options.interactive) {
      this.snapSentence.addClass('interactive');
      this.attachDraggers();
      this.attachEvents();
      this.attachHovers();
    }
    if (this.teacherTreeJson) {
      this.showDiffs(this.teacherTreeJson);
    }
  }

  public update(reactiveSentence: ReactiveSentence): void {
    this.treeJson = reactiveSentence.state.treeJson;
    this.metaJson = reactiveSentence.state.metaJson;
    this.tokenSVGs = [];
    this.refresh();
  }

  plugDiffTree(teacherReactiveSentence: ReactiveSentence): void {
    if (teacherReactiveSentence?.state?.treeJson) {
      this.teacherTreeJson = teacherReactiveSentence?.state?.treeJson;
      this.drawTree();
      // TODO : find a way to attach the otherReactiveSentence so it listen to teacher's changes
      // the line below is not working properly as it makes the otherReactiveSentence to update off screen
      // and this make svg drawing not working
      // teacherReactiveSentence.attach(this)
    }
  }
  unplugDiffTree(): void {
    if (this.teacherTreeJson) {
      this.teacherTreeJson = emptyTreeJson();
      this.drawTree();
    }
  }

  clearTree(): void {
    this.snapSentence.clear();
    this.tokenSVGs = [];
    this.levelsArray = [];
    this.orderOfTokens = [];
    this.tokenIndexToSvgPosition = {};
  }

  populateOrderOfTokens(): void {
    // the conllup-js returnTokensInOrder() method doesn't take RightToLeft mode into account
    // ... as it's a rendering problem only. We still need to modify the stack as we can only render
    // ... the svg starting from left

    let stack: string[] = [];
    let orderOfTokens: string[] = [];

    const tokensInOrder = returnTokensInOrder(
      this.treeJson,
      this.options.drawEnhancedTokens,
      this.options.drawGroupTokens,
    );

    for (const tokenJson of tokensInOrder) {
      if (this.metaJson.rtl === 'yes') {
        // the full sentence is in RTL mode
        stack.push(tokenJson.ID);
        if (tokenJson.MISC.rtl !== 'no') {
          // the token is not in RTL mode (his following token will be at his right)
          orderOfTokens = stack.concat(orderOfTokens);
          stack = [];
        }
      } else {
        // the full sentence is in conventional mode
        stack.unshift(tokenJson.ID);
        if (tokenJson.MISC.rtl !== 'yes') {
          // the token is in RTL mode (his following token will be at his left)
          orderOfTokens = orderOfTokens.concat(JSON.parse(JSON.stringify(stack)));
          stack = [];
        }
      }
    }
    if (this.metaJson.rtl === 'yes') {
      this.orderOfTokens = stack.concat(orderOfTokens);
    } else {
      this.orderOfTokens = orderOfTokens.concat(stack);
    }
  }

  populateTokenSVGs(): void {
    let runningX = 0;
    const maxLevelY = Math.max(...this.levelsArray, 2); // 2 would be the minimum possible level size
    const offsetY = SVG_CONFIG.startTextY + maxLevelY * this.options.arcHeight;

    let tokenSvgIndex = 0;
    const firstX = "1" in this.presetLocations?this.presetLocations["1"].x:0;
    for (const tokenJsonIndex of this.orderOfTokens) {
      const tokenJson = getNodeFromTreeJson(this.treeJson, tokenJsonIndex);
      if (tokenJson) {
        const tokenSVG = new TokenSVG(tokenJson, this);
        this.tokenSVGs.push(tokenSVG);
	const tid = tokenJsonIndex;
	// console.log(`populating ${tid}, ${Object.keys(this.presetLocations)}`)
	// if (tid in this.presetLocations) console.log(`preset box X value for ${tid}: ${this.presetLocations[tid].x}`);
	const theX = (tid in this.presetLocations)?this.presetLocations[tid].x - firstX:runningX;
        tokenSVG.createSnap(this.snapSentence, this.options.shownFeatures, theX, offsetY);
        tokenSVG.ylevel = this.levelsArray[tokenSvgIndex];
        runningX += tokenSVG.width;
        tokenSvgIndex += 1;
      }
    }
  }

  updateToken(tokenJson: tokenJson_T): void {
    this.treeJson.nodesJson[tokenJson.ID] = tokenJson;
  }

  getHeadsIdsArray(): number[] {
    // HeadsIdsArray is the array representing the SvgIndex of the head of each SvgToken
    this.tokenIndexToSvgPosition = {};
    let i = 0;
    for (const tokenJsonIndex of this.orderOfTokens) {
      this.tokenIndexToSvgPosition[tokenJsonIndex] = i;
      i = i + 1;
    }
    const headsIdsArray = [];
    for (const tokenJsonIndex of this.orderOfTokens) {
      const tokenJson = getNodeFromTreeJson(this.treeJson, tokenJsonIndex);
      if (tokenJson) {
        if (tokenJson.HEAD >= 1) {
          headsIdsArray.push(this.tokenIndexToSvgPosition[tokenJson.HEAD]);
        } else {
          headsIdsArray.push(ROOT_ID_IN_SVG);
        }
      }
    }
    return headsIdsArray;
  }

  populateLevels(): void {
    const headsIdsArray = this.getHeadsIdsArray();

    const levelsArray: number[] = new Array(headsIdsArray.length).fill(ROOT_ID_IN_SVG);
    for (let i = 0; i < headsIdsArray.length; i++) {
      this.getLevel(levelsArray, headsIdsArray, i, 0, headsIdsArray.length);
    }
    this.levelsArray = levelsArray;
  }

  getLevel(levelsArray: number[], headsIdsArray: number[], index: number, start: number, end: number): number {
    if (levelsArray[index] !== ROOT_ID_IN_SVG) {
      return levelsArray[index];
    }
    const headId = headsIdsArray[index];
    if (headId < start || end < headId) {
      if (headId === ROOT_ID_IN_SVG) {
        levelsArray[index] = 0;
      }

      return 0;
    }
    const inf = Math.min(index, headId);
    const sup = Math.max(index, headId);
    if (sup - inf === 1) {
      levelsArray[index] = 1;
      return 1;
    }
    const levelsSubArray = [];

    for (let i = inf; i <= sup; i++) {
      if (i === index || headsIdsArray[headsIdsArray[i]] === i) {
        levelsSubArray.push(0);
      } else if (inf <= headsIdsArray[i] && headsIdsArray[i] <= sup) {
        // sup is outside the scope for avoiding infinite recursion loop
        levelsSubArray.push(this.getLevel(levelsArray, headsIdsArray, i, inf, sup));
      }
    }

    const level: number = Math.max(...levelsSubArray) + 1;
    levelsArray[index] = level;
    return level;
  }

  drawRelations(): void {
    for (const tokenSVG of this.tokenSVGs) {
      const headId = tokenSVG.tokenJson.HEAD;
      let headCoordX = 0;
      if (headId > 0) {
        const headtokenSVG = this.tokenSVGs[this.tokenIndexToSvgPosition[headId]];
        headCoordX = headtokenSVG.centerX;
        // if governor is root, draw root relation
      } else if (headId === 0) {
        headCoordX = 0;
      } else {
        // console.log(
        //   "this nodeTree has no governor, not drawing it",
        //   tokenSVG.tokenJson.ID
        // );
        continue;
      }
      tokenSVG.drawRelation(this.snapSentence, headCoordX, this.options.arcHeight);
    }
  }

  drawEnhancedRelations(): void {
    const currentMaxHeight = this.computeCurrentMaxHeight(); // we want the DEPS arc to start below the bottomest FEATS/MISC/FORM/etc...
    for (const tokenSVG of this.tokenSVGs) {
      for (const [depID, depDEPREL] of Object.entries(tokenSVG.tokenJson.DEPS)) {
        const depTokenJson = getNodeFromTreeJson(this.treeJson, depID);
        if (depTokenJson && depTokenJson.ID !== tokenSVG.tokenJson.HEAD.toString()) {
          // we don't redraw an enhanced relation that is already a normal relation
          const depTokenSVG = this.tokenSVGs[this.tokenIndexToSvgPosition[depID]];
          const headCoordX = depTokenSVG.centerX;
          const depInfo = { ID: depID, DEPREL: depDEPREL };
          tokenSVG.drawEnhancedRelation(
            this.snapSentence,
            headCoordX,
            this.options.arcHeight,
            depInfo,
            currentMaxHeight,
          );
        }
      }
    }
  }

  computeCurrentMaxHeight() {
    // compute the current max height of the svg
    // this is used to adapt the svg canvas size
    let currentMaxHeight = 0;
    for (const tokenSVG of this.tokenSVGs) {
      const tokenSVGHeight = Math.max(
        ...Object.values(tokenSVG.snapElements).map((snapElement) => snapElement.getBBox().y2),
      );
      currentMaxHeight = Math.max(currentMaxHeight, tokenSVGHeight);
    }
    return currentMaxHeight;
  }

  adaptSvgCanvas(): void {
    // get the maximum x and y of the svg for resizing the window
    this.totalWidth = Math.max(...this.tokenSVGs.map((x) => x.startX + x.width));
    this.totalHeight = this.computeCurrentMaxHeight();
    this.snapSentence.attr({ width: this.totalWidth + 15 });
    this.snapSentence.attr({ height: this.totalHeight || 1000 }); // 1000 was there in case the SVG pop up after the div, so it give a heigth
  }

  showhighlights() {
    for (const tokenSVG of this.tokenSVGs) {
      tokenSVG.showhighlight();
    }
  }

  showmatches() {
    for (const tokenSVG of this.tokenSVGs) {
      if (this.options.matches.includes(tokenSVG.tokenJson.ID.toString())) {
        tokenSVG.showmatch();
      }
    }
  }

  showpackages() {
    if (this.options.packages !== null) {
      const modifiedNodesId = this.options.packages.modified_nodes.map((modifiedNode) => modifiedNode.id);
      for (const tokenSVG of this.tokenSVGs) {
        if (modifiedNodesId.includes(tokenSVG.tokenJson.ID.toString())) {
          const modifiedNode =
            this.options.packages.modified_nodes.filter((mNode) => mNode.id === tokenSVG.tokenJson.ID.toString())[0] ||
            null;
          if (modifiedNode !== null) {
            tokenSVG.showmodifiednode(modifiedNode.features);
          }
        }
      }

      const modifiedEdgesSrc = this.options.packages.modified_edges.map((modifiedEdge) => modifiedEdge.tar);
      for (const tokenSVG of this.tokenSVGs) {
        if (modifiedEdgesSrc.includes(tokenSVG.tokenJson.ID.toString())) {
          tokenSVG.showmodifiededge();
        }
      }
    }
  }

  attachEvents() {
    for (const tokenSVG of this.tokenSVGs) {
      tokenSVG.attachEvent();
    }
  }

  attachDraggers() {
    for (const tokenSVG of this.tokenSVGs) {
      tokenSVG.attachDragger();
    }
  }

  attachHovers() {
    for (const tokenSVG of this.tokenSVGs) {
      tokenSVG.attachHover();
    }
  }

  showDiffs(otherTreeJson: treeJson_T) {
    if (otherTreeJson.nodesJson.constructor !== Object) {
      return;
    }
    if (Object.keys(otherTreeJson.nodesJson).length === 0 || Object.keys(this.treeJson.nodesJson).length === 0) {
      return;
    }
    if (Object.keys(otherTreeJson.nodesJson).length !== Object.keys(this.treeJson.nodesJson).length) {
      return;
    }
    for (const tokenIndex of this.orderOfTokens) {
      const otherTokenJson = getNodeFromTreeJson(otherTreeJson, tokenIndex);
      const thisTokenJson = getNodeFromTreeJson(this.treeJson, tokenIndex);
      if (otherTokenJson && thisTokenJson && otherTokenJson.FORM === thisTokenJson.FORM) {
        this.tokenSVGs[this.tokenIndexToSvgPosition[tokenIndex]].showDiff(otherTokenJson);
      } else {
        console.log(`Error, token id ${tokenIndex} doesn't match`);
      }
    }
  }

  getDiffStats(otherTreeConll: string) {
    const teacherTreeJson = sentenceConllToJson(otherTreeConll).treeJson;
    const currentTreeJson = this.treeJson;

    const corrects: { [key: string]: number } = {
      HEAD: 0,
      DEPREL: 0,
      UPOS: 0,
    };
    const totals: { [key: string]: number } = {
      HEAD: 0,
      DEPREL: 0,
      UPOS: 0,
    };

    for (const tokenIndex in teacherTreeJson.nodesJson) {
      if (teacherTreeJson.nodesJson[tokenIndex]) {
        for (const tag in corrects) {
          if (
            teacherTreeJson.nodesJson[tokenIndex][tag] !== '_' &&
            !Object.is(teacherTreeJson.nodesJson[tokenIndex][tag], NaN)
          ) {
            corrects[tag] += +(
              teacherTreeJson.nodesJson[tokenIndex][tag] === currentTreeJson.nodesJson[tokenIndex][tag]
            );
            totals[tag]++;
          }
        }
      }
    }

    return { corrects, totals };
  }

  exportConll() {
    return sentenceJsonToConll({
      treeJson: this.treeJson,
      metaJson: this.metaJson,
    });
  }

  refresh() {
    this.drawTree();
  }
}

///////////////                ////////////////
///////////////   tokenSVG  ////////////////
///////////////                ////////////////

class TokenSVG {
  // type definitions
  tokenJson: tokenJson_T;
  sentenceSVG: SentenceSVG;
  startY = 0;
  startX = 0;
  width = 0;
  ylevel = 0;
  shownFeatures: string[] = [];
  centerX = 0;
  // snap elements
  // snapArc: ??? = ???
  // snapArrowhead: ??? = ???
  // snapDeprel: ??? = ???
  // snapElements: ??[] = ???
  // draggedForm : ??? (snap)
  snapSentence!: Snap.Paper;
  snapElements: { [key: string]: Snap.Element } = {};

  draggedForm!: Snap.Element;
  draggedFormClone!: Snap.Element;

  dragclicktime = 0;
  X_draggedBoxCenter = 0;
  Y_draggedBoxUpper = 0;

  draggedCurve!: Snap.Element;
  draggedArrowhead!: Snap.Element;
  dragRootCircle?: Snap.Element;

  constructor(tokenJson: tokenJson_T, sentenceSVG: SentenceSVG) {
    this.sentenceSVG = sentenceSVG;
    this.tokenJson = tokenJson;

    // populate the FEATS and MISC child features
    const listLabels: (keyof tokenJson_T)[] = ['FEATS', 'MISC'];
    for (const label of listLabels) {
      for (const [key, value] of Object.entries(tokenJson[label])) {
        tokenJson[`${label}.${key}`] = value;
      }
    }

    this.snapElements = {};
  }

  createSnap(snapSentence: Snap.Paper, shownFeatures: string[], startX: number, startY: number): void {
    this.snapSentence = snapSentence;
    this.shownFeatures = shownFeatures;
    this.startX = startX;
    this.startY = startY || 10;
    let runningY = this.startY;

    let maxFeatureWidth = 0;
    for (const feature of shownFeatures) {
      // create new snap node for the feature text
      let featureText: string;

      // check if there is a feature and if it's a nested feature (misc and feats)
      if (this.tokenJson[feature]) {
        if (feature.split('.').length >= 2) {
          // if len >=2, it means it's a misc or feats
          featureText = `${feature.split('.')[1]}=${this.tokenJson[feature]}`;
        } else {
          featureText = this.tokenJson[feature] as string;
        }
      } else {
        featureText = '';
      }
      const snapFeature = snapSentence.text(this.startX, runningY, featureText);
      snapFeature.addClass(feature.split('.')[0]);

      this.snapElements[feature] = snapFeature;
      // handle width properties
      const featureWidth = snapFeature.getBBox().w;
      maxFeatureWidth = Math.max(maxFeatureWidth, featureWidth); // keep biggest node width

      // increment position except if feature is a FEATS or MISC which is not present for the token
      if (!(['MISC', 'FEATS'].includes(feature.split('.')[0]) && featureText === '')) {
        runningY += this.sentenceSVG.options.featuresHorizontalSpacing;
      }
    }
    this.width = maxFeatureWidth + this.sentenceSVG.options.tokenSpacing;
    this.centerX = this.startX + this.width / 2;

    this.centerFeatures();
  }

  centerFeatures(): void {
    // center the feature in the column node
    // |hello    |my    |friend    | => |  hello  |  my  |  friend  |
    for (const feature of this.shownFeatures) {
      const snapFeature = this.snapElements[feature];
      const featureWidth = snapFeature.getBBox().w;
      snapFeature.attr({ x: this.centerX - featureWidth / 2 });
    }
  }

  drawRelation(snapSentence: Snap.Paper, headCoordX: number, levelHeight: number): void {
    // draw the relation for a treeNode and attach to it

    const heightArc = this.startY - this.ylevel * levelHeight;

    const X_depBoxCenter = this.centerX;
    let X_headBoxCenter = 0;
    const Y_depBoxUpperBound = this.startY - SVG_CONFIG.sizeFontY;
    let Y_arcBoxUpperBound = 0;
    let arcPath = '';
    if (headCoordX === 0) {
      arcPath = getArcPathRoot(X_depBoxCenter, Y_depBoxUpperBound);
    } else {
      Y_arcBoxUpperBound = heightArc;
      const newId = this.sentenceSVG.tokenIndexToSvgPosition[this.tokenJson.ID];
      const newHead = this.sentenceSVG.tokenIndexToSvgPosition[this.tokenJson.HEAD.toString()];
      X_headBoxCenter = newId > newHead ? headCoordX + SVG_CONFIG.gapX / 2 : headCoordX - SVG_CONFIG.gapX / 2;
      arcPath = getArcPath(X_depBoxCenter, X_headBoxCenter, Y_depBoxUpperBound, Y_depBoxUpperBound, Y_arcBoxUpperBound);
    }

    const snapArc = snapSentence.path(arcPath).addClass('curve');

    const arrowheadPath = getArrowheadPath(X_depBoxCenter, Y_depBoxUpperBound);
    const snapArrowhead = snapSentence.path(arrowheadPath).addClass('arrowhead');

    let deprelX = snapArc.getBBox().x + snapArc.getBBox().w / 2;
    let deprelY = snapArc.getBBox().y - 5;

    // replace the deprel when it's the root
    if (headCoordX === 0) {
      deprelX += 20;
      deprelY = 30;
    }

    const snapDeprel = snapSentence.text(deprelX, deprelY, this.tokenJson.DEPREL).addClass('DEPREL');

    snapDeprel.attr({ x: deprelX - snapDeprel.getBBox().w / 2 });
    this.snapElements['DEPREL'] = snapDeprel;
    this.snapElements['arrowhead'] = snapArrowhead;
    this.snapElements['arc'] = snapArc;
  }

  drawEnhancedRelation(
    snapSentence: Snap.Paper,
    headCoordX: number,
    levelHeight: number,
    depsInfo: { ID: string; DEPREL: string },
    Y_start: number,
  ): void {
    // const heightArc = this.startY - this.ylevel * levelHeight;
    const Y_depBoxLowerBound = Y_start + 14;
    const Y_arcBoxLowerBound = Y_depBoxLowerBound + levelHeight; // this is where we need to add dynamic height of arc

    const X_depBoxCenter = this.centerX;
    let X_headBoxCenter = 0;

    const newId = this.sentenceSVG.tokenIndexToSvgPosition[this.tokenJson.ID];
    const newHead = this.sentenceSVG.tokenIndexToSvgPosition[this.tokenJson.HEAD.toString()];
    X_headBoxCenter = newId > newHead ? headCoordX + SVG_CONFIG.gapX / 2 : headCoordX - SVG_CONFIG.gapX / 2;
    const arcPath = getArcPath(
      X_depBoxCenter,
      X_headBoxCenter,
      Y_depBoxLowerBound,
      Y_depBoxLowerBound,
      Y_arcBoxLowerBound,
    );

    const snapArc = snapSentence.path(arcPath).addClass('curveenhanced');

    const arrowheadPath = getArrowheadPath(X_depBoxCenter, Y_depBoxLowerBound);
    const snapArrowhead = snapSentence.path(arrowheadPath).addClass('arrowheadenhanced');
    snapArrowhead.transform('r180'); // rotate the head 180 degrees as it's a reverse drawing

    const deprelX = snapArc.getBBox().x + snapArc.getBBox().w / 2;
    const deprelY = snapArc.getBBox().y2 + 10;

    const snapDeprel = snapSentence.text(deprelX, deprelY, `E:${depsInfo.DEPREL}`).addClass('DEPRELenhanced');

    snapDeprel.attr({ x: deprelX - snapDeprel.getBBox().w / 2 });
    this.snapElements[`${depsInfo}.DEPREL`] = snapDeprel;
    this.snapElements[`${depsInfo}.arrowhead`] = snapArrowhead;
    this.snapElements[`${depsInfo}.arc`] = snapArc;
  }

  showhighlight(): void {
    if (this.tokenJson.MISC.highlight) {
      this.snapElements['FORM'].node.style.fill = this.tokenJson.MISC.highlight;
    }
  }

  showmatch(): void {
    this.snapElements['FORM'].node.style.fill = 'red';
  }

  showmodifiednode(features: string[]): void {
    if (features.includes('upos')) {
      this.snapElements['UPOS'].node.style.fill = 'red';
    }
    if (features.includes('form')) {
      this.snapElements['FORM'].node.style.fill = 'red';
    }
    if (features.includes('lemma')) {
      this.snapElements['LEMMA'].node.style.fill = 'red';
    }
    if (features.includes('deprel')) {
      this.snapElements['DEPREL'].node.style.fill = 'red';
    }
    for (const feature of features) {
      for (const miscOrFeat of ['FEATS', 'MISC']) {
        if (this.snapElements[`${miscOrFeat}.${feature}`] !== undefined) {
          this.snapElements[`${miscOrFeat}.${feature}`].node.style.fill = 'red';
          break;
        }
      }
    }
  }

  showmodifiededge(): void {
    this.snapElements['arc'].node.style.stroke = 'red';
    this.snapElements['arrowhead'].node.style.stroke = 'red';
  }

  attachEvent(): void {
    for (const [label, snapElement] of Object.entries(this.snapElements)) {
      snapElement.click((e: Event) => {
        // be careful, 'this' is the element because it's normal function
        // const event = new Event("svg-click")
        const event = new CustomEvent('svg-click', {
          detail: {
            treeNode: this,
            targetLabel: label,
            clicked: this.tokenJson.ID,
            event: e,
          },
        });
        this.sentenceSVG.dispatchEvent(event);
      });
    }
  }

  attachDragger(): void {
    this.draggedForm = this.snapElements['FORM'];
    this.draggedForm.drag(this.dragging, this.startDrag, this.stopDrag, this); // `this` act like the context. (Similar to .bind(this))
  }

  attachHover(): void {
    this.snapElements['FORM'].mouseover(() => {
      if (this.sentenceSVG.dragged && this.tokenJson.ID !== this.sentenceSVG.dragged) {
        this.snapElements['FORM'].addClass('glossy');
        this.sentenceSVG.hovered = this.tokenJson.ID;
      }
    });
    this.snapElements['FORM'].mouseout(() => {
      if (this.sentenceSVG.dragged && this.tokenJson.ID !== this.sentenceSVG.dragged) {
        this.snapElements['FORM'].removeClass('glossy');
        this.sentenceSVG.hovered = '';
      }
    });
  }

  showDiff(otherTokenJson: tokenJson_T): void {
    if (
      (this.tokenJson.HEAD === 0 || this.tokenJson.HEAD >= 1) &&
      !Object.is(this.tokenJson.HEAD, Number.NaN) &&
      otherTokenJson.HEAD !== this.tokenJson.HEAD
    ) {
      this.snapElements['arc'].addClass('diff');
      this.snapElements['arrowhead'].addClass('diff');
    }
    if (this.tokenJson.DEPREL && this.tokenJson.DEPREL !== '_' && otherTokenJson.DEPREL !== this.tokenJson.DEPREL) {
      this.snapElements['DEPREL'].addClass('diff');
    }
    if (this.tokenJson.UPOS && this.tokenJson.UPOS !== '_' && otherTokenJson.UPOS !== this.tokenJson.UPOS) {
      this.snapElements['UPOS'].addClass('diff');
    }
  }

  startDrag(): void {
    // `this` is a treeNode instance
    //  `this.draggedForm` is the Snap object that's being dragged
    this.dragclicktime = new Date().getTime();
    // create a copy of the FROM that will be deleted after dragging
    this.draggedFormClone = this.draggedForm.clone();
    this.draggedFormClone.attr({ cursor: 'move' });
    this.X_draggedBoxCenter = this.centerX;
    this.Y_draggedBoxUpper = this.draggedForm.getBBox().y;

    this.sentenceSVG.dragged = this.tokenJson.ID;

    // starting dragging, we need a dummy empty path so we can reuse it in the dragging function (without needing to add class)
    const DUMMY_PATH = '';
    this.draggedCurve = this.snapSentence.path(DUMMY_PATH).addClass('dragcurve');
    this.draggedArrowhead = this.snapSentence
      .path(getArrowheadPath(this.X_draggedBoxCenter, this.Y_draggedBoxUpper))
      .addClass('dragarrowhead');
    this.dragRootCircle = undefined;
  }

  dragging(dx: number, dy: number): void {
    // `this` is a treeNode instance
    // `this.draggedForm` is the Snap object that's being dragged
    this.draggedFormClone.transform('translate(' + (dx - 15) + ',' + (dy - 30) + ')');
    this.draggedFormClone.addClass('glossy');
    const xb = this.X_draggedBoxCenter;
    const yb = this.Y_draggedBoxUpper;

    const xa = xb + dx;
    const ya = yb + dy;

    let y_offset = -40; // arc is above tokens
    // if mouth is slighly below tokens, move arc below tokens
    if (dy > SVG_CONFIG.reverseArcThreshold) {
      y_offset = 40; // arc is below tokens
    }
    const Y_top = Math.max(0, yb + dy + y_offset);
    // let Y_top = Math.max(0, yb + dy - Math.abs(dx) / 2);
    const path = getArcPath(xb, xa, yb, ya, Y_top);
    this.draggedCurve.attr({ d: path });
    this.draggedArrowhead.transform('translate(' + dx + ',' + dy + ')');

    const leveldistance = this.sentenceSVG.options.arcHeight;
    if (yb + dy < leveldistance / 2 && Math.abs(dx) < leveldistance / 2) {
      if (this.dragRootCircle === undefined) {
        this.dragRootCircle = this.snapSentence.circle(xb, 0, leveldistance / 2).addClass('dragcurve');
      }
    } else {
      if (this.dragRootCircle !== undefined) {
        this.dragRootCircle.remove();
        this.dragRootCircle = undefined;
      }
    }
  }

  stopDrag(e: Event): void {
    let event;
    if (new Date().getTime() < this.dragclicktime + SVG_CONFIG.dragclickthreshold) {
      event = new CustomEvent('svg-click', {
        detail: {
          treeNode: this,
          clicked: this.tokenJson.ID,
          targetLabel: 'FORM',
        },
      });
    } else {
      event = new CustomEvent('svg-drop', {
        detail: {
          treeNode: this,
          hovered: this.sentenceSVG.hovered,
          dragged: this.sentenceSVG.dragged,
          isRoot: !!this.dragRootCircle,
        },
      });
      e.preventDefault();
      e.stopPropagation();
    }
    this.sentenceSVG.dispatchEvent(event);
    this.sentenceSVG.dragged = '';
    if (this.sentenceSVG.hovered) {
      this.sentenceSVG.tokenSVGs[this.sentenceSVG.tokenIndexToSvgPosition[this.sentenceSVG.hovered]].snapElements[
        'FORM'
      ].removeClass('glossy');
      this.sentenceSVG.hovered = '';
    }

    this.draggedFormClone.animate({ transform: 'translate(' + 0 + ',' + 0 + ')' }, 300, () => {
      this.draggedFormClone.remove();
      return 0;
    });
    this.draggedCurve.remove();
    this.draggedArrowhead.remove();
    if (this.dragRootCircle !== undefined) {
      this.dragRootCircle.remove();
      this.dragRootCircle = undefined;
    }
  }
}

///////////////             ////////////////
/////////////// SVG ELEMENT ////////////////
///////////////             ////////////////

function getArrowheadPath(X_depBoxCenter: number, Y_depBoxUpperBound: number): string {
  // gives path for arrowhead X_depBoxCenter is where is the center of the arrow on abscisse
  // Y_depBoxUpperBound is the bottom of the arrow startpoint (end of arrow)

  const arrowheadsize = SVG_CONFIG.arrowheadsize;
  const startpoint = X_depBoxCenter + ',' + Y_depBoxUpperBound; // to move the arrowhead lower: (y+this.sizes.arrowheadsize/3);
  const lefttop =
    '0,0' + -arrowheadsize / 2 + ',' + -arrowheadsize * 1.5 + ' ' + -arrowheadsize / 2 + ',' + -arrowheadsize * 1.5;
  const righttop =
    arrowheadsize / 2 +
    ',' +
    arrowheadsize / 2 +
    ' ' +
    arrowheadsize / 2 +
    ',' +
    arrowheadsize / 2 +
    ' ' +
    arrowheadsize +
    ',0';
  return 'M' + startpoint + 'c' + lefttop + 'c' + righttop + 'z';
}

function getArcPath(X_start: number, X_end: number, Y_start: number, Y_end: number, Y_height: number): string {
  // X_start,Y_start is the starting position
  // X_end,Y_end is the ending position
  // Y_height is the height of the arc
  return (
    'M' +
    X_start +
    ',' +
    Y_start + // starting point
    ' C' +
    X_start +
    ',' +
    Y_height + // first control point
    ' ' +
    X_end +
    ',' +
    Y_height + // second control point
    ' ' +
    X_end +
    ',' +
    Y_end
  ); // ending point
}

function getArcPathRoot(X_depBoxCenter: number, Y_depBoxUpperBound: number): string {
  return 'M' + X_depBoxCenter + ',' + Y_depBoxUpperBound + ' L' + X_depBoxCenter + ',' + '0 ';
}
