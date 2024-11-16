/* Copyright 2022 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  Util,
} from "../../shared/util.js";
import { AnnotationCustomElement } from "../annotation_layer.js";
import { AnnotationEditor } from "./editor.js";
import { bindEvents } from "./tools.js";
import { ColorPicker } from "./color_picker.js";
import { HighlightOutliner } from "./drawers/highlight.js";

/**
 * Basic draw editor in order to generate an Highlight annotation.
 */
class AnnotationCustomEditor extends AnnotationEditor {
  #anchorNode = null;

  #anchorOffset = 0;

  #boxes;

  #clipPathId = null;

  #colorPicker = null;

  #focusOutlines = null;

  #focusNode = null;

  #focusOffset = 0;

  #highlightDiv = null;

  #highlightOutlines = null;

  #id = null;

  #lastPoint = null;

  #opacity;

  #outlineId = null;

  #text = "";

  #methodOfCreation = "";

  static _defaultColor = null;

  static _defaultOpacity = 1;

  static _defaultThickness = 12;

  static _type = "custom";

  static _editorType = AnnotationEditorType.CUSTOM;

  constructor(params) {
    super({ ...params, name: "AnnotationCustomEditor" });
    this.color = params.color || AnnotationCustomEditor._defaultColor;
    this.#opacity = params.opacity || AnnotationCustomEditor._defaultOpacity;
    this.#boxes = params.boxes || null;
    this.#methodOfCreation = params.methodOfCreation || "";
    this.#text = params.text || "";
    this._isDraggable = false;

    if (this.#boxes) {
      this.#anchorNode = params.anchorNode;
      this.#anchorOffset = params.anchorOffset;
      this.#focusNode = params.focusNode;
      this.#focusOffset = params.focusOffset;
      this.#createOutlines();
      this.#addToDrawLayer();
      this.rotate(this.rotation);
    }
  }

  /** @inheritdoc */
  get telemetryInitialData() {
    return {
      action: "added",
      type: "custom",
      color: this._uiManager.highlightColorNames.get(this.color),
      methodOfCreation: this.#methodOfCreation,
    };
  }

  /** @inheritdoc */
  get telemetryFinalData() {
    return {
      type: "custom",
      color: this._uiManager.highlightColorNames.get(this.color),
    };
  }

  static computeTelemetryFinalData(data) {
    // We want to know how many colors have been used.
    return { numberOfColors: data.get("color").size };
  }

  #createOutlines() {
    const outliner = new HighlightOutliner(
      this.#boxes,
      /* borderWidth = */ 0.001
    );
    this.#highlightOutlines = outliner.getOutlines();
    ({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    } = this.#highlightOutlines.box);

    const outlinerForOutline = new HighlightOutliner(
      this.#boxes,
      /* borderWidth = */ 0.0025,
      /* innerMargin = */ 0.001,
      this._uiManager.direction === "ltr"
    );
    this.#focusOutlines = outlinerForOutline.getOutlines();

    // The last point is in the pages coordinate system.
    const { lastPoint } = this.#focusOutlines.box;
    this.#lastPoint = [
      (lastPoint[0] - this.x) / this.width,
      (lastPoint[1] - this.y) / this.height,
    ];
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    AnnotationCustomEditor._defaultColor ||=
      uiManager.highlightColors?.values().next().value || "#fff066";
  }

  /** @inheritdoc */
  static updateDefaultParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR:
        AnnotationCustomEditor._defaultColor = value;
        break;
    }
  }

  /** @inheritdoc */
  translateInPage(x, y) {}

  /** @inheritdoc */
  get toolbarPosition() {
    return this.#lastPoint;
  }

  /** @inheritdoc */
  updateParams(type, value) {
    switch (type) {
      case AnnotationEditorParamsType.HIGHLIGHT_COLOR:
        this.#updateColor(value);
        break;
    }
  }

  static get defaultPropertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.HIGHLIGHT_DEFAULT_COLOR,
        AnnotationCustomEditor._defaultColor,
      ],
    ];
  }

  /** @inheritdoc */
  get propertiesToUpdate() {
    return [
      [
        AnnotationEditorParamsType.HIGHLIGHT_COLOR,
        this.color || AnnotationCustomEditor._defaultColor,
      ],
    ];
  }

  /**
   * Update the color and make this action undoable.
   * @param {string} color
   */
  #updateColor(color) {
    const setColorAndOpacity = (col, opa) => {
      this.color = col;
      this.parent?.drawLayer.changeColor(this.#id, col);
      this.#colorPicker?.updateColor(col);
      this.#opacity = opa;
      this.parent?.drawLayer.changeOpacity(this.#id, opa);
    };
    const savedColor = this.color;
    const savedOpacity = this.#opacity;
    this.addCommands({
      cmd: setColorAndOpacity.bind(
        this,
        color,
        AnnotationCustomEditor._defaultOpacity
      ),
      undo: setColorAndOpacity.bind(this, savedColor, savedOpacity),
      post: this._uiManager.updateUI.bind(this._uiManager, this),
      mustExec: true,
      type: AnnotationEditorParamsType.HIGHLIGHT_COLOR,
      overwriteIfSameType: true,
      keepUndo: true,
    });

    this._reportTelemetry(
      {
        action: "color_changed",
        color: this._uiManager.highlightColorNames.get(color),
      },
      /* mustWait = */ true
    );
  }

  /** @inheritdoc */
  async addEditToolbar() {
    const toolbar = await super.addEditToolbar();
    if (!toolbar) {
      return null;
    }
    if (this._uiManager.highlightColors) {
      this.#colorPicker = new ColorPicker({ editor: this });
      toolbar.addColorPicker(this.#colorPicker);
    }
    return toolbar;
  }

  /** @inheritdoc */
  disableEditing() {
    super.disableEditing();
    this.div.classList.toggle("disabled", true);
  }

  /** @inheritdoc */
  enableEditing() {
    super.enableEditing();
    this.div.classList.toggle("disabled", false);
  }

  /** @inheritdoc */
  fixAndSetPosition() {
    return super.fixAndSetPosition(this.#getRotation());
  }

  /** @inheritdoc */
  getBaseTranslation() {
    // The editor itself doesn't have any CSS border (we're drawing one
    // ourselves in using SVG).
    return [0, 0];
  }

  /** @inheritdoc */
  getRect(tx, ty) {
    return super.getRect(tx, ty, this.#getRotation());
  }

  /** @inheritdoc */
  onceAdded() {
    if (!this.annotationElementId) {
      this.parent.addUndoableEditor(this);
    }
    this.div.focus();
  }

  /** @inheritdoc */
  remove() {
    this.#cleanDrawLayer();
    this._reportTelemetry({
      action: "deleted",
    });
    super.remove();
  }

  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }

    this.#addToDrawLayer();

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilding it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  setParent(parent) {
    let mustBeSelected = false;
    if (this.parent && !parent) {
      this.#cleanDrawLayer();
    } else if (parent) {
      this.#addToDrawLayer(parent);
      // If mustBeSelected is true it means that this editor was selected
      // when its parent has been destroyed, hence we must select it again.
      mustBeSelected =
        !this.parent && this.div?.classList.contains("selectedEditor");
    }
    super.setParent(parent);
    this.show(this._isVisible);
    if (mustBeSelected) {
      // We select it after the parent has been set.
      this.select();
    }
  }

  #cleanDrawLayer() {
    if (this.#id === null || !this.parent) {
      return;
    }
    this.parent.drawLayer.remove(this.#id);
    this.#id = null;
    this.parent.drawLayer.remove(this.#outlineId);
    this.#outlineId = null;
  }

  #addToDrawLayer(parent = this.parent) {
    if (this.#id !== null) {
      return;
    }
    ({ id: this.#id, clipPathId: this.#clipPathId } = parent.drawLayer.draw(
      this.#highlightOutlines,
      this.color,
      this.#opacity
    ));
    this.#outlineId = parent.drawLayer.drawOutline(this.#focusOutlines);
    if (this.#highlightDiv) {
      this.#highlightDiv.style.clipPath = this.#clipPathId;
    }
  }

  static #rotateBbox({ x, y, width, height }, angle) {
    switch (angle) {
      case 90:
        return {
          x: 1 - y - height,
          y: x,
          width: height,
          height: width,
        };
      case 180:
        return {
          x: 1 - x - width,
          y: 1 - y - height,
          width,
          height,
        };
      case 270:
        return {
          x: y,
          y: 1 - x - width,
          width: height,
          height: width,
        };
    }
    return {
      x,
      y,
      width,
      height,
    };
  }

  /** @inheritdoc */
  rotate(angle) {
    // We need to rotate the svgs because of the coordinates system.
    const { drawLayer } = this.parent;
    const box = AnnotationCustomEditor.#rotateBbox(this, angle);
    drawLayer.rotate(this.#id, angle);
    drawLayer.rotate(this.#outlineId, angle);
    drawLayer.updateBox(this.#id, box);
    drawLayer.updateBox(
      this.#outlineId,
      AnnotationCustomEditor.#rotateBbox(this.#focusOutlines.box, angle)
    );
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    const div = super.render();
    if (this.#text) {
      div.setAttribute("aria-label", this.#text);
      div.setAttribute("role", "mark");
    }
    const highlightDiv = (this.#highlightDiv = document.createElement("div"));
    div.append(highlightDiv);
    highlightDiv.setAttribute("aria-hidden", "true");
    highlightDiv.className = "internal";
    highlightDiv.style.clipPath = this.#clipPathId;
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(this.width * parentWidth, this.height * parentHeight);

    bindEvents(this, this.#highlightDiv, ["pointerover", "pointerleave"]);
    this.enableEditing();

    return div;
  }

  pointerover() {
    if (!this.isSelected) {
      this.parent.drawLayer.addClass(this.#outlineId, "hovered");
    }
  }

  pointerleave() {
    if (!this.isSelected) {
      this.parent.drawLayer.removeClass(this.#outlineId, "hovered");
    }
  }

  #setCaret(start) {
    if (!this.#anchorNode) {
      return;
    }
    const selection = window.getSelection();
    if (start) {
      selection.setPosition(this.#anchorNode, this.#anchorOffset);
    } else {
      selection.setPosition(this.#focusNode, this.#focusOffset);
    }
  }

  /** @inheritdoc */
  select() {
    super.select();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.removeClass(this.#outlineId, "hovered");
    this.parent?.drawLayer.addClass(this.#outlineId, "selected");
  }

  /** @inheritdoc */
  unselect() {
    super.unselect();
    if (!this.#outlineId) {
      return;
    }
    this.parent?.drawLayer.removeClass(this.#outlineId, "selected");
    this.#setCaret(/* start = */ false);
  }

  /** @inheritdoc */
  show(visible = this._isVisible) {
    super.show(visible);
    if (this.parent) {
      this.parent.drawLayer.show(this.#id, visible);
      this.parent.drawLayer.show(this.#outlineId, visible);
    }
  }

  #getRotation() {
    return 0;
  }

  #serializeBoxes() {
    const [pageWidth, pageHeight] = this.pageDimensions;
    const [pageX, pageY] = this.pageTranslation;
    const boxes = this.#boxes;
    const quadPoints = new Float32Array(boxes.length * 8);
    let i = 0;
    for (const { x, y, width, height } of boxes) {
      const sx = x * pageWidth + pageX;
      const sy = (1 - y - height) * pageHeight + pageY;
      // The specifications say that the rectangle should start from the bottom
      // left corner and go counter-clockwise.
      // But when opening the file in Adobe Acrobat it appears that this isn't
      // correct hence the 4th and 6th numbers are just swapped.
      quadPoints[i] = quadPoints[i + 4] = sx;
      quadPoints[i + 1] = quadPoints[i + 3] = sy;
      quadPoints[i + 2] = quadPoints[i + 6] = sx + width * pageWidth;
      quadPoints[i + 5] = quadPoints[i + 7] = sy + height * pageHeight;
      i += 8;
    }
    return quadPoints;
  }

  #serializeOutlines(rect) {
    return this.#highlightOutlines.serialize(rect, this.#getRotation());
  }

  /** @inheritdoc */
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof AnnotationCustomElement) {
      const {
        data: { quadPoints, rect, rotation, id, color, opacity, popupRef },
        parent: {
          page: { pageNumber },
        },
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.CUSTOM,
        color: Array.from(color),
        opacity,
        quadPoints,
        boxes: null,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        id,
        deleted: false,
        popupRef,
      };
    }

    const { color, quadPoints, opacity } = data;
    const editor = await super.deserialize(data, parent, uiManager);

    editor.color = Util.makeHexColor(...color);
    editor.#opacity = opacity || 1;
    editor.annotationElementId = data.id || null;
    editor._initialData = initialData;

    const [pageWidth, pageHeight] = editor.pageDimensions;
    const [pageX, pageY] = editor.pageTranslation;

    if (quadPoints) {
      const boxes = (editor.#boxes = []);
      for (let i = 0; i < quadPoints.length; i += 8) {
        boxes.push({
          x: (quadPoints[i] - pageX) / pageWidth,
          y: 1 - (quadPoints[i + 1] - pageY) / pageHeight,
          width: (quadPoints[i + 2] - quadPoints[i]) / pageWidth,
          height: (quadPoints[i + 1] - quadPoints[i + 5]) / pageHeight,
        });
      }
      editor.#createOutlines();
      editor.#addToDrawLayer();
      editor.rotate(editor.rotation);
    }

    return editor;
  }

  /** @inheritdoc */
  serialize(isForCopying = false) {
    // It doesn't make sense to copy/paste a highlight annotation.
    if (this.isEmpty() || isForCopying) {
      return null;
    }

    if (this.deleted) {
      return this.serializeDeleted();
    }

    const rect = this.getRect(0, 0);
    const color = AnnotationEditor._colorManager.convert(this.color);

    const serialized = {
      annotationType: AnnotationEditorType.CUSTOM,
      color,
      opacity: this.#opacity,
      quadPoints: this.#serializeBoxes(),
      outlines: this.#serializeOutlines(rect),
      pageIndex: this.pageIndex,
      rect,
      rotation: this.#getRotation(),
      structTreeParentId: this._structTreeParentId,
    };

    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }

    serialized.id = this.annotationElementId;
    return serialized;
  }

  #hasElementChanged(serialized) {
    const { color } = this._initialData;
    return serialized.color.some((c, i) => c !== color[i]);
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation) {
    annotation.updateEdited({
      rect: this.getRect(0, 0),
    });

    return null;
  }

  static canCreateNewEmptyEditor() {
    return false;
  }
}

export { AnnotationCustomEditor };
