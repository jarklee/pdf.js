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
      }, 0);
    });

    // Process when custom menu hide/shown.
    // Usually will trigger some action on host
    PDFViewerApplication.eventBus.on(
      "annotation_custom_menu",
      function ({ shown, data, wrapperId }) {
        window.parent.postMessage(
          {
            action: "annotationCustomMenu",
            shown,
            data,
            wrapperId,
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

    // Register render for custom button when edit menu open
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
  }

  function getEditorsByPredicate({ type, ids, externalIds }) {
    const storage =
      PDFViewerApplication.pdfViewer._layerProperties.annotationStorage;
    let editors = Object.values(storage.getAll());
    if (type) {
      editors = editors.filter(function (e) {
        return e.editorType === type;
      });
    }
    if (ids) {
      editors = editors.filter(function (e) {
        return ids.includes(e.id);
      });
    }
    if (externalIds) {
      editors = editors.filter(function (e) {
        return externalIds.includes(e.externalId);
      });
    }
    return editors;
  }

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
          color,
          customData,
          externalId,
        },
        PDFViewerAnnotationEditorType.CUSTOM
      );
    }

    return {
      queue,
      drain,
    };
  })();

  const actionsHandlers = {
    showHighlight(data) {
      const pageIndex = data.pageIndex;
      addAnnotationQueue.queue(pageIndex, data);
      addAnnotationQueue.drain(pageIndex);
    },
    removeHighlight(data) {
      const { predicate } = data;
      for (const editor of getEditorsByPredicate({
        ...predicate,
        type: "custom",
      })) {
        editor.remove();
      }
    },
    updateHighlight(data) {
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
          if (realKey) {
            editor.updateParams(realKey, values[key]);
          }
        }
      }
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
