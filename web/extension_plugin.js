/* eslint-disable no-undef */
$(function () {
  function callback() {
    PDFViewerApplication.eventBus.on("highlightSelection", function (editor) {
      PDFViewerApplication.pdfViewer._layerProperties.annotationEditorUIManager.removeEditorByPredicate(
        function (id, otherEditor) {
          if (otherEditor.editorType !== "custom") {
            return false;
          }
          return !otherEditor.externalId && editor.id !== id;
        }
      );
    });

    PDFViewerApplication.eventBus.on("pagerendered", function (e) {
      const pageIndex = e.pageNumber - 1;
      setTimeout(function () {
        addAnnotationQueue.drain(pageIndex, 3);
        scrollManager.scrollPending(pageIndex);
      }, 0);
    });

    // Process when custom menu hide/shown.
    // Usually will trigger some action on host
    PDFViewerApplication.eventBus.on(
      "annotation_custom_menu",
      function ({ shown, data, wrapperId }) {
        const nodeId = data.uiNodeId;
        const nodeEl = document.querySelector(`#${nodeId}`);
        window.parent.postMessage(
          {
            action: "annotationCustomMenu",
            shown,
            data,
            wrapperId,
            highlightedCoords: nodeEl?.getClientRects()?.[0],
          },
          "*"
        );
      }
    );

    PDFViewerApplication.eventBus.on(
      "annotation_custom_removed",
      function (data) {
        window.parent.postMessage(
          {
            action: "annotationCustomRemoved",
            data,
          },
          "*"
        );
      }
    );

    /*
    // Register render for custom button when edit menu open
    // Sample code, remove if need
    PDFViewerSharedToolbarRenderRegistry.instance.register(
      `editor_menu_${PDFViewerAnnotationEditorType.CUSTOM}`,
      function renderCustomAnnotationMenu({ close, editor, uiManager, data }) {
        const buttons = [];
        const aiButton = document.createElement("button");
        aiButton.textContent = "Ai comment";
        aiButton.onclick = function () {
          console.log("hello ai", data.text);
          close();
        };
        buttons.push(aiButton);
        return buttons;
      }
    );
    */
  }

  function getEditorsByPredicate({
    type,
    ids,
    externalIds,
    withOutExternalId,
  }) {
    const storage =
      PDFViewerApplication.pdfViewer._layerProperties.annotationStorage;
    let editors = Object.values(storage.getAll());
    if (type) {
      editors = editors.filter(function (e) {
        return e.editorType === type;
      });
    }
    if (ids && ids.length > 0) {
      editors = editors.filter(function (e) {
        return ids.includes(e.id);
      });
    }
    if (externalIds && externalIds.length > 0) {
      editors = editors.filter(function (e) {
        return externalIds.includes(e.externalId);
      });
    }
    if (withOutExternalId) {
      editors = editors.filter(function (e) {
        return !e.externalId;
      });
    }
    return editors;
  }

  const normalizeColor = (function () {
    const colorManager = new PDFViewerColorManager();
    const hexNumbers = Array.from(Array(256).keys(), n =>
      n.toString(16).padStart(2, "0")
    );
    return function (color, forSerialized) {
      if (forSerialized) {
        if (Array.isArray(color)) {
          return color;
        }
        return colorManager.convert(color);
      }
      if (Array.isArray(color)) {
        const [r, g, b] = color;
        return `#${hexNumbers[r]}${hexNumbers[g]}${hexNumbers[b]}`;
      }
      return color;
    };
  })();

  const addAnnotationQueue = (function () {
    const addQueue = {};

    function queue(pageIndex, data) {
      const bucket = addQueue[pageIndex] ?? [];
      bucket.push(data);
      addQueue[pageIndex] = bucket;
    }

    function drain(pageIndex, retry = 0) {
      const page = PDFViewerApplication.pdfViewer.getPageView(pageIndex);
      if (!page) {
        // page not exists
        if (retry > 0) {
          setTimeout(function () {
            drain(pageIndex, retry - 1);
          }, 10);
        }
        return;
      }
      if (!page.annotationEditorLayer) {
        // page not rendered
        if (retry > 0) {
          setTimeout(function () {
            drain(pageIndex, retry - 1);
          }, 10);
        }
        return;
      }
      const pending = addQueue[pageIndex] ?? [];
      if (pending.length > 0) {
        addQueue[pageIndex] = [];
        for (const data of pending) {
          if (data.fromSerialized) {
            addFromSerialized(page, data);
          } else {
            addFromBoxes(page, data);
          }
        }
      }
    }

    function addFromSerialized(page, data) {
      const editorLayer = page.annotationEditorLayer.annotationEditorLayer;
      editorLayer.deserialize(data).then(function (editor) {
        editorLayer.add(editor);
      });
    }

    function addFromBoxes(page, data) {
      const editorLayer = page.annotationEditorLayer.annotationEditorLayer;
      const { boxes, text, color, customData, externalId } = data;
      const {
        rawDims: { pageWidth, pageHeight, pageX, pageY },
      } = page.viewport;
      const uiBoxes = [];
      for (const box of boxes) {
        uiBoxes.push({
          x: (box.x - pageX) / pageWidth,
          y: (box.y - pageY) / pageHeight,
          width: box.width / pageWidth,
          height: box.height / pageHeight,
        });
      }
      editorLayer.createAndAddNewEditor(
        { offsetX: 0, offsetY: 0 },
        false,
        {
          methodOfCreation: "",
          boxes: uiBoxes,
          text,
          color: normalizeColor(color, false),
          customData,
          externalId,
        },
        PDFViewerAnnotationEditorType.CUSTOM
      );
    }

    function makeFilter({ type, ids, externalIds, withOutExternalId }) {
      function filterByType(e) {
        if (!e.fromSerialized) {
          // only serialized has type, other hardcoded as custom type
          return type === PDFViewerAnnotationEditorType.CUSTOM;
        }
        return e.annotationType === type;
      }

      function filterById(e) {
        if (!e.fromSerialized) {
          return false;
        }
        return ids.includes(e.uiNodeId);
      }

      function filterByExternalIds(e) {
        return externalIds.includes(e.externalId);
      }

      return function (e) {
        let matched = 0;
        if (type) {
          if (!filterByType(e)) {
            return false;
          }
          matched++;
        }
        if (ids && ids.length > 0) {
          if (!filterById(e)) {
            return false;
          }
          matched++;
        }
        if (externalIds && externalIds.length > 0) {
          if (!filterByExternalIds(e)) {
            return false;
          }
          matched++;
        }
        if (withOutExternalId) {
          matched += !e.externalId ? 1 : 0;
        }
        return matched > 0;
      };
    }

    function removePending(predicate) {
      const filter = makeFilter(predicate);
      Object.keys(addQueue).forEach(function (pageIndex) {
        addQueue[pageIndex] = addQueue[pageIndex].filter(function (e) {
          return !filter(e);
        });
      });
    }

    function updatePending({ predicate, values }) {
      const filter = makeFilter(predicate);

      function update(e) {
        const keyMap = {
          color: "color",
          data: "customData",
          externalId: "externalId",
        };
        const updateKeys = Object.keys(values);
        for (const key of updateKeys) {
          const realKey = keyMap[key];
          if (!realKey) {
            continue;
          }
          let value = values[key];
          if (key === "color") {
            if (!value) {
              continue;
            }
            value = normalizeColor(value, false);
          }
          if (!value && key === "color") {
            // skip update color if no value
            continue;
          }
          e[realKey] = value;
        }
        return e;
      }

      Object.keys(addQueue).forEach(function (pageIndex) {
        addQueue[pageIndex] = addQueue[pageIndex].map(function (e) {
          if (!filter(e)) {
            return e;
          }
          return update(e);
        });
      });
    }

    return {
      queue,
      drain,
      removePending,
      updatePending,
    };
  })();

  const annotationManager = (function () {
    function removeHighlight(predicate) {
      for (const editor of getEditorsByPredicate({
        ...predicate,
        type: "custom",
      })) {
        editor.remove();
      }
    }

    function updateHighlight(data) {
      const { predicate, values } = data;
      const keyMap = {
        color: PDFViewerAnnotationEditorParamsType.ANNOTATION_CUSTOM_COLOR,
        data: PDFViewerAnnotationEditorParamsType.ANNOTATION_CUSTOM_DATA,
        externalId:
          PDFViewerAnnotationEditorParamsType.ANNOTATION_CUSTOM_EXTERNAL_ID,
      };
      const updateKeys = Object.keys(values);

      for (const editor of getEditorsByPredicate({
        ...predicate,
        type: "custom",
      })) {
        for (const key of updateKeys) {
          const realKey = keyMap[key];
          if (!realKey) {
            continue;
          }
          let value = values[key];
          if (key === "color") {
            if (!value) {
              continue;
            }
            value = normalizeColor(value, false);
          }
          if (!value && key === "color") {
            // skip update color if no value
            continue;
          }
          editor.updateParams(realKey, value);
        }
      }
    }

    return {
      removeHighlight,
      updateHighlight,
    };
  })();

  const scrollManager = (function () {
    let pending;
    let scrollingToken;

    function scrollPending(pageIndex) {
      if (pending?.pageIndex !== pageIndex) {
        return;
      }
      cancelScrollToEditor();

      const editors = getEditorsByPredicate(pending.predicate);
      pending = undefined;
      if (editors.length === 0) {
        return;
      }
      const inPageEditor = editors.find(function (e) {
        return e.pageIndex === pageIndex;
      });
      const editor = inPageEditor ?? editors[0];
      if (!editor) {
        return;
      }
      if (editor.pageIndex !== pageIndex) {
        actionsHandlers.scrollToPage({ pageIndex: editor.pageIndex });
        scrollingToken = setTimeout(function () {
          scrollToEditor(editor, 3);
        }, 100);
      } else {
        scrollToEditor(editor, 3);
      }
    }

    function scrollToEditor(editor, retry = 3) {
      if (editor.div?.isConnected) {
        editor.div.scrollIntoViewIfNeeded();
        return;
      }
      if (retry > 0) {
        scrollingToken = setTimeout(function () {
          scrollToEditor(editor, retry - 1);
        }, 10);
      }
    }

    function cancelScrollToEditor() {
      if (scrollingToken) {
        clearTimeout(scrollingToken);
        scrollingToken = undefined;
      }
    }

    function queueScroll(pageIndex, predicate) {
      cancelScrollToEditor();
      actionsHandlers.scrollToPage({ pageIndex });
      pending = { pageIndex, predicate };
      const page = PDFViewerApplication.pdfViewer.getPageView(pageIndex);
      if (!page) {
        return;
      }
      scrollPending(pageIndex);
    }

    return {
      scrollPending,
      queueScroll,
    };
  })();

  const actionsHandlers = {
    showHighlight(data) {
      const pageIndex = data.pageIndex;
      addAnnotationQueue.queue(pageIndex, data);
      addAnnotationQueue.drain(pageIndex);
    },
    removeHighlight({ predicate }) {
      annotationManager.removeHighlight(predicate);
      addAnnotationQueue.removePending(predicate);
    },
    updateHighlight(data) {
      annotationManager.updateHighlight(data);
      addAnnotationQueue.updatePending(data);
    },
    scrollToPage({ pageIndex }) {
      pageIndex = Math.round(pageIndex);
      if (Number.isNaN(pageIndex)) {
        return;
      }
      PDFViewerApplication.page = pageIndex + 1;
    },
    scrollToAnnotation({ pageIndex, predicate }) {
      scrollManager.queueScroll(pageIndex, predicate);
    },
  };

  window.$actionHandlers = actionsHandlers;

  window.addEventListener("message", function (e) {
    const detail = e.data;
    const handler = actionsHandlers[detail.action];
    if (handler) {
      handler(detail);
    }
  });

  if (PDFViewerApplication.eventBus) {
    callback();
  } else {
    window.addEventListener("pdfviewloaded", callback);
  }
});
