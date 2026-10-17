var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/justified-layout/lib/row.js
var require_row = __commonJS({
  "../../node_modules/justified-layout/lib/row.js"(exports, module) {
    var Row = module.exports = function(params) {
      this.top = params.top;
      this.left = params.left;
      this.width = params.width;
      this.spacing = params.spacing;
      this.targetRowHeight = params.targetRowHeight;
      this.targetRowHeightTolerance = params.targetRowHeightTolerance;
      this.minAspectRatio = this.width / params.targetRowHeight * (1 - params.targetRowHeightTolerance);
      this.maxAspectRatio = this.width / params.targetRowHeight * (1 + params.targetRowHeightTolerance);
      this.edgeCaseMinRowHeight = params.edgeCaseMinRowHeight;
      this.edgeCaseMaxRowHeight = params.edgeCaseMaxRowHeight;
      this.widowLayoutStyle = params.widowLayoutStyle;
      this.isBreakoutRow = params.isBreakoutRow;
      this.items = [];
      this.height = 0;
    };
    Row.prototype = {
      /**
       * Attempt to add a single item to the row.
       * This is the heart of the justified algorithm.
       * This method is direction-agnostic; it deals only with sizes, not positions.
       *
       * If the item fits in the row, without pushing row height beyond min/max tolerance,
       * the item is added and the method returns true.
       *
       * If the item leaves row height too high, there may be room to scale it down and add another item.
       * In this case, the item is added and the method returns true, but the row is incomplete.
       *
       * If the item leaves row height too short, there are too many items to fit within tolerance.
       * The method will either accept or reject the new item, favoring the resulting row height closest to within tolerance.
       * If the item is rejected, left/right padding will be required to fit the row height within tolerance;
       * if the item is accepted, top/bottom cropping will be required to fit the row height within tolerance.
       *
       * @method addItem
       * @param itemData {Object} Item layout data, containing item aspect ratio.
       * @return {Boolean} True if successfully added; false if rejected.
       */
      addItem: function(itemData) {
        var newItems = this.items.concat(itemData), rowWidthWithoutSpacing = this.width - (newItems.length - 1) * this.spacing, newAspectRatio = newItems.reduce(function(sum, item) {
          return sum + item.aspectRatio;
        }, 0), targetAspectRatio = rowWidthWithoutSpacing / this.targetRowHeight, previousRowWidthWithoutSpacing, previousAspectRatio, previousTargetAspectRatio;
        if (this.isBreakoutRow) {
          if (this.items.length === 0) {
            if (itemData.aspectRatio >= 1) {
              this.items.push(itemData);
              this.completeLayout(rowWidthWithoutSpacing / itemData.aspectRatio, "justify");
              return true;
            }
          }
        }
        if (newAspectRatio < this.minAspectRatio) {
          this.items.push(Object.assign({}, itemData));
          return true;
        } else if (newAspectRatio > this.maxAspectRatio) {
          if (this.items.length === 0) {
            this.items.push(Object.assign({}, itemData));
            this.completeLayout(rowWidthWithoutSpacing / newAspectRatio, "justify");
            return true;
          }
          previousRowWidthWithoutSpacing = this.width - (this.items.length - 1) * this.spacing;
          previousAspectRatio = this.items.reduce(function(sum, item) {
            return sum + item.aspectRatio;
          }, 0);
          previousTargetAspectRatio = previousRowWidthWithoutSpacing / this.targetRowHeight;
          if (Math.abs(newAspectRatio - targetAspectRatio) > Math.abs(previousAspectRatio - previousTargetAspectRatio)) {
            this.completeLayout(previousRowWidthWithoutSpacing / previousAspectRatio, "justify");
            return false;
          } else {
            this.items.push(Object.assign({}, itemData));
            this.completeLayout(rowWidthWithoutSpacing / newAspectRatio, "justify");
            return true;
          }
        } else {
          this.items.push(Object.assign({}, itemData));
          this.completeLayout(rowWidthWithoutSpacing / newAspectRatio, "justify");
          return true;
        }
      },
      /**
       * Check if a row has completed its layout.
       *
       * @method isLayoutComplete
       * @return {Boolean} True if complete; false if not.
       */
      isLayoutComplete: function() {
        return this.height > 0;
      },
      /**
       * Set row height and compute item geometry from that height.
       * Will justify items within the row unless instructed not to.
       *
       * @method completeLayout
       * @param newHeight {Number} Set row height to this value.
       * @param widowLayoutStyle {String} How should widows display? Supported: left | justify | center
       */
      completeLayout: function(newHeight, widowLayoutStyle) {
        var itemWidthSum = this.left, rowWidthWithoutSpacing = this.width - (this.items.length - 1) * this.spacing, clampedToNativeRatio, clampedHeight, errorWidthPerItem, roundedCumulativeErrors, singleItemGeometry, centerOffset;
        if (typeof widowLayoutStyle === "undefined" || ["justify", "center", "left"].indexOf(widowLayoutStyle) < 0) {
          widowLayoutStyle = "left";
        }
        clampedHeight = Math.max(this.edgeCaseMinRowHeight, Math.min(newHeight, this.edgeCaseMaxRowHeight));
        if (newHeight !== clampedHeight) {
          this.height = clampedHeight;
          clampedToNativeRatio = rowWidthWithoutSpacing / clampedHeight / (rowWidthWithoutSpacing / newHeight);
        } else {
          this.height = newHeight;
          clampedToNativeRatio = 1;
        }
        this.items.forEach(function(item) {
          item.top = this.top;
          item.width = item.aspectRatio * this.height * clampedToNativeRatio;
          item.height = this.height;
          item.left = itemWidthSum;
          itemWidthSum += item.width + this.spacing;
        }, this);
        if (widowLayoutStyle === "justify") {
          itemWidthSum -= this.spacing + this.left;
          errorWidthPerItem = (itemWidthSum - this.width) / this.items.length;
          roundedCumulativeErrors = this.items.map(function(item, i) {
            return Math.round((i + 1) * errorWidthPerItem);
          });
          if (this.items.length === 1) {
            singleItemGeometry = this.items[0];
            singleItemGeometry.width -= Math.round(errorWidthPerItem);
          } else {
            this.items.forEach(function(item, i) {
              if (i > 0) {
                item.left -= roundedCumulativeErrors[i - 1];
                item.width -= roundedCumulativeErrors[i] - roundedCumulativeErrors[i - 1];
              } else {
                item.width -= roundedCumulativeErrors[i];
              }
            });
          }
        } else if (widowLayoutStyle === "center") {
          centerOffset = (this.width - itemWidthSum) / 2;
          this.items.forEach(function(item) {
            item.left += centerOffset + this.spacing;
          }, this);
        }
      },
      /**
       * Force completion of row layout with current items.
       *
       * @method forceComplete
       * @param fitToWidth {Boolean} Stretch current items to fill the row width.
       *                             This will likely result in padding.
       * @param fitToWidth {Number}
       */
      forceComplete: function(fitToWidth, rowHeight) {
        if (typeof rowHeight === "number") {
          this.completeLayout(rowHeight, this.widowLayoutStyle);
        } else {
          this.completeLayout(this.targetRowHeight, this.widowLayoutStyle);
        }
      },
      /**
       * Return layout data for items within row.
       * Note: returns actual list, not a copy.
       *
       * @method getItems
       * @return Layout data for items within row.
       */
      getItems: function() {
        return this.items;
      }
    };
  }
});

// ../../node_modules/justified-layout/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/justified-layout/lib/index.js"(exports, module) {
    "use strict";
    var Row = require_row();
    function createNewRow(layoutConfig, layoutData) {
      var isBreakoutRow;
      if (layoutConfig.fullWidthBreakoutRowCadence !== false) {
        if ((layoutData._rows.length + 1) % layoutConfig.fullWidthBreakoutRowCadence === 0) {
          isBreakoutRow = true;
        }
      }
      return new Row({
        top: layoutData._containerHeight,
        left: layoutConfig.containerPadding.left,
        width: layoutConfig.containerWidth - layoutConfig.containerPadding.left - layoutConfig.containerPadding.right,
        spacing: layoutConfig.boxSpacing.horizontal,
        targetRowHeight: layoutConfig.targetRowHeight,
        targetRowHeightTolerance: layoutConfig.targetRowHeightTolerance,
        edgeCaseMinRowHeight: 0.5 * layoutConfig.targetRowHeight,
        edgeCaseMaxRowHeight: 2 * layoutConfig.targetRowHeight,
        rightToLeft: false,
        isBreakoutRow,
        widowLayoutStyle: layoutConfig.widowLayoutStyle
      });
    }
    function addRow(layoutConfig, layoutData, row) {
      layoutData._rows.push(row);
      layoutData._layoutItems = layoutData._layoutItems.concat(row.getItems());
      layoutData._containerHeight += row.height + layoutConfig.boxSpacing.vertical;
      return row.items;
    }
    function computeLayout(layoutConfig, layoutData, itemLayoutData) {
      var laidOutItems = [], itemAdded, currentRow, nextToLastRowHeight;
      if (layoutConfig.forceAspectRatio) {
        itemLayoutData.forEach(function(itemData) {
          itemData.forcedAspectRatio = true;
          itemData.aspectRatio = layoutConfig.forceAspectRatio;
        });
      }
      itemLayoutData.some(function(itemData, i) {
        if (isNaN(itemData.aspectRatio)) {
          throw new Error("Item " + i + " has an invalid aspect ratio");
        }
        if (!currentRow) {
          currentRow = createNewRow(layoutConfig, layoutData);
        }
        itemAdded = currentRow.addItem(itemData);
        if (currentRow.isLayoutComplete()) {
          laidOutItems = laidOutItems.concat(addRow(layoutConfig, layoutData, currentRow));
          if (layoutData._rows.length >= layoutConfig.maxNumRows) {
            currentRow = null;
            return true;
          }
          currentRow = createNewRow(layoutConfig, layoutData);
          if (!itemAdded) {
            itemAdded = currentRow.addItem(itemData);
            if (currentRow.isLayoutComplete()) {
              laidOutItems = laidOutItems.concat(addRow(layoutConfig, layoutData, currentRow));
              if (layoutData._rows.length >= layoutConfig.maxNumRows) {
                currentRow = null;
                return true;
              }
              currentRow = createNewRow(layoutConfig, layoutData);
            }
          }
        }
      });
      if (currentRow && currentRow.getItems().length && layoutConfig.showWidows) {
        if (layoutData._rows.length) {
          if (layoutData._rows[layoutData._rows.length - 1].isBreakoutRow) {
            nextToLastRowHeight = layoutData._rows[layoutData._rows.length - 1].targetRowHeight;
          } else {
            nextToLastRowHeight = layoutData._rows[layoutData._rows.length - 1].height;
          }
          currentRow.forceComplete(false, nextToLastRowHeight);
        } else {
          currentRow.forceComplete(false);
        }
        laidOutItems = laidOutItems.concat(addRow(layoutConfig, layoutData, currentRow));
        layoutConfig._widowCount = currentRow.getItems().length;
      }
      layoutData._containerHeight = layoutData._containerHeight - layoutConfig.boxSpacing.vertical;
      layoutData._containerHeight = layoutData._containerHeight + layoutConfig.containerPadding.bottom;
      return {
        containerHeight: layoutData._containerHeight,
        widowCount: layoutConfig._widowCount,
        boxes: layoutData._layoutItems
      };
    }
    module.exports = function(input, config) {
      var layoutConfig = {};
      var layoutData = {};
      var defaults = {
        containerWidth: 1060,
        containerPadding: 10,
        boxSpacing: 10,
        targetRowHeight: 320,
        targetRowHeightTolerance: 0.25,
        maxNumRows: Number.POSITIVE_INFINITY,
        forceAspectRatio: false,
        showWidows: true,
        fullWidthBreakoutRowCadence: false,
        widowLayoutStyle: "left"
      };
      var containerPadding = {};
      var boxSpacing = {};
      config = config || {};
      layoutConfig = Object.assign(defaults, config);
      containerPadding.top = !isNaN(parseFloat(layoutConfig.containerPadding.top)) ? layoutConfig.containerPadding.top : layoutConfig.containerPadding;
      containerPadding.right = !isNaN(parseFloat(layoutConfig.containerPadding.right)) ? layoutConfig.containerPadding.right : layoutConfig.containerPadding;
      containerPadding.bottom = !isNaN(parseFloat(layoutConfig.containerPadding.bottom)) ? layoutConfig.containerPadding.bottom : layoutConfig.containerPadding;
      containerPadding.left = !isNaN(parseFloat(layoutConfig.containerPadding.left)) ? layoutConfig.containerPadding.left : layoutConfig.containerPadding;
      boxSpacing.horizontal = !isNaN(parseFloat(layoutConfig.boxSpacing.horizontal)) ? layoutConfig.boxSpacing.horizontal : layoutConfig.boxSpacing;
      boxSpacing.vertical = !isNaN(parseFloat(layoutConfig.boxSpacing.vertical)) ? layoutConfig.boxSpacing.vertical : layoutConfig.boxSpacing;
      layoutConfig.containerPadding = containerPadding;
      layoutConfig.boxSpacing = boxSpacing;
      layoutData._layoutItems = [];
      layoutData._awakeItems = [];
      layoutData._inViewportItems = [];
      layoutData._leadingOrphans = [];
      layoutData._trailingOrphans = [];
      layoutData._containerHeight = layoutConfig.containerPadding.top;
      layoutData._rows = [];
      layoutData._orphans = [];
      layoutConfig._widowCount = 0;
      return computeLayout(layoutConfig, layoutData, input.map(function(item) {
        if (item.width && item.height) {
          return { aspectRatio: item.width / item.height };
        } else {
          return { aspectRatio: item };
        }
      }));
    };
  }
});

// src/renderer/src/layout.ts
var import_justified_layout = __toESM(require_lib(), 1);

// src/renderer/src/format.ts
var at = (a, i) => a[i];
var numbers = new Intl.NumberFormat();
var months = new Intl.DateTimeFormat(void 0, {
  month: "long",
  year: "numeric"
});
var days = new Intl.DateTimeFormat(void 0, {
  month: "short",
  day: "numeric",
  year: "numeric"
});
var longDays = new Intl.DateTimeFormat(void 0, {
  month: "long",
  day: "numeric",
  year: "numeric"
});
var month = (ms) => months.format(ms);

// src/renderer/src/layout.ts
var HEAD = 44;
var GAP = 4;
function monthGroups(index) {
  const t = index.takenAt;
  const groups = [];
  let start = 0;
  let from = 0;
  let to = -1;
  for (let i = 0; i < t.length; i++) {
    const ti = at(t, i);
    if (ti >= from && ti < to) continue;
    if (i > 0) groups.push({ label: month(at(t, start)), start, end: i });
    const d = new Date(ti);
    from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    start = i;
  }
  if (t.length)
    groups.push({ label: month(at(t, start)), start, end: t.length });
  return groups;
}
function justify(aspect, groups, width, rowHeight, square) {
  const n = aspect.length;
  const geo = {
    rows: [],
    left: new Float32Array(n),
    width: new Float32Array(n),
    row: new Uint32Array(n),
    heads: [],
    height: 0
  };
  let y = 0;
  groups.forEach((g, group) => {
    geo.heads.push(geo.rows.length);
    geo.rows.push({ kind: "head", top: y, height: HEAD, group });
    y += HEAD;
    const { boxes, containerHeight } = (0, import_justified_layout.default)(
      Array.prototype.slice.call(aspect, g.start, g.end),
      {
        containerWidth: width,
        containerPadding: 0,
        boxSpacing: GAP,
        targetRowHeight: rowHeight,
        forceAspectRatio: square ? 1 : false
      }
    );
    let current;
    for (let k = 0; k < boxes.length; k++) {
      const b = at(boxes, k);
      const i = g.start + k;
      if (!current || y + b.top !== current.top) {
        current = {
          kind: "tiles",
          top: y + b.top,
          height: b.height,
          group,
          start: i,
          end: i
        };
        geo.rows.push(current);
      }
      current.end = i + 1;
      geo.left[i] = b.left;
      geo.width[i] = b.width;
      geo.row[i] = geo.rows.length - 1;
    }
    y += containerHeight;
  });
  geo.height = y;
  return geo;
}
function rowAt(geo, y) {
  let lo = 0;
  let hi = geo.rows.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (at(geo.rows, mid).top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
var center = (geo, i) => at(geo.left, i) + at(geo.width, i) / 2;
function nearestInRow(geo, r, x) {
  const row = geo.rows[r];
  if (row?.kind !== "tiles") return -1;
  let best = row.start;
  for (let i = row.start; i < row.end; i++) {
    if (Math.abs(center(geo, i) - x) < Math.abs(center(geo, best) - x)) best = i;
  }
  return best;
}
function tilesRow(geo, r, step) {
  for (; r >= 0 && r < geo.rows.length; r += step)
    if (at(geo.rows, r).kind === "tiles") return r;
  return -1;
}
function move(geo, i, key, viewport) {
  const n = geo.left.length;
  const x = center(geo, i);
  const r = at(geo.row, i);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, i - 1);
    case "ArrowRight":
      return Math.min(n - 1, i + 1);
    case "Home":
      return 0;
    case "End":
      return n - 1;
    case "ArrowUp":
    case "ArrowDown": {
      const step = key === "ArrowUp" ? -1 : 1;
      const target = tilesRow(geo, r + step, step);
      return target < 0 ? i : nearestInRow(geo, target, x);
    }
    case "PageUp":
    case "PageDown": {
      const step = key === "PageUp" ? -1 : 1;
      const y = at(geo.rows, r).top + step * viewport;
      const target = tilesRow(geo, rowAt(geo, Math.max(0, y)), step);
      return target < 0 ? step < 0 ? 0 : n - 1 : nearestInRow(geo, target, x);
    }
  }
  return i;
}
export {
  GAP,
  HEAD,
  justify,
  monthGroups,
  move,
  rowAt
};
/*! Bundled license information:

justified-layout/lib/row.js:
justified-layout/lib/index.js:
  (*!
   * Copyright 2019 SmugMug, Inc.
   * Licensed under the terms of the MIT license. Please see LICENSE file in the project root for terms.
   * @license
   *)
*/
