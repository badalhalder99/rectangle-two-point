import { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

interface Label {
  div: HTMLDivElement;
  point: THREE.Vector3;
}

interface Rectangle {
  points: THREE.Vector3[];
  lines: THREE.Line[];
  widthLabel: Label | null;
  heightLabel: Label | null;
}

export const ARMeasure = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isARSupported, setIsARSupported] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let camera: THREE.PerspectiveCamera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let controller: THREE.XRTargetRaySpace;
    let reticle: THREE.Mesh;
    let hitTestSource: any = null;
    const hitTestSourceRequested = false;

    // The first two taps define the height (a reference vector + line).
    let heightPoints: THREE.Vector3[] = [];
    let heightVector: THREE.Vector3 | null = null;

    // Base corners of the shape currently being drawn.
    // firstBasePoint is the bottom of the height line; the loop closes back to it.
    let firstBasePoint: THREE.Vector3 | null = null;
    let lastBasePoint: THREE.Vector3 | null = null;
    let wallCount = 0;

    // Reusable lines that preview the wall the next tap will create.
    let previewLines: THREE.Line[] = [];

    // Store completed walls.
    const rectangles: Rectangle[] = [];

    const init = async () => {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

      const ambient = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2);
      ambient.position.set(0.5, 1, 0.25);
      scene.add(ambient);

      const light = new THREE.DirectionalLight();
      light.position.set(0.2, 1, 1);
      scene.add(light);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;

      if (containerRef.current) {
        containerRef.current.appendChild(renderer.domElement);
      }

      const button = ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: containerRef.current as HTMLElement },
      });

      document.body.appendChild(button);

      controller = renderer.xr.getController(0);
      controller.addEventListener('select', onSelect);
      scene.add(controller);

      reticle = createReticle();
      scene.add(reticle);

      window.addEventListener('resize', onWindowResize, false);

      setIsARSupported(true);
      animate();
    };

    const createReticle = () => {
      const ring = new THREE.RingGeometry(0.045, 0.05, 32).rotateX(-Math.PI / 2);
      const dot = new THREE.CircleGeometry(0.005, 32).rotateX(-Math.PI / 2);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        ...ring.attributes.position.array,
        ...dot.attributes.position.array
      ], 3));

      const material = new THREE.MeshBasicMaterial();
      const reticleMesh = new THREE.Mesh(geometry, material);
      reticleMesh.matrixAutoUpdate = false;
      reticleMesh.visible = false;
      return reticleMesh;
    };

    const createLine = (start: THREE.Vector3, end: THREE.Vector3) => {
      const points = [start.clone(), end.clone()];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 12,
        linecap: 'round'
      });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      return line;
    };

    const updateLine = (line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3) => {
      const positions = line.geometry.attributes.position.array as Float32Array;
      positions[0] = start.x;
      positions[1] = start.y;
      positions[2] = start.z;
      positions[3] = end.x;
      positions[4] = end.y;
      positions[5] = end.z;
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    };

    const createLabel = (text: string, position: THREE.Vector3) => {
      if (!containerRef.current) return null;
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = text;
      containerRef.current.appendChild(label);
      return {
        div: label,
        point: position.clone()
      };
    };

    const getMidpoint = (point1: THREE.Vector3, point2: THREE.Vector3) => {
      return new THREE.Vector3().addVectors(point1, point2).multiplyScalar(0.5);
    };

    const getDistance = (point1: THREE.Vector3, point2: THREE.Vector3) => {
      return point1.distanceTo(point2);
    };

    // Build a rectangle (wall) between two base corners, extruded upward by the
    // shared height vector. Each wall labels its own width and height.
    const createWall = (baseStart: THREE.Vector3, baseEnd: THREE.Vector3) => {
      if (!heightVector) return;

      const topStart = baseStart.clone().add(heightVector);
      const topEnd = baseEnd.clone().add(heightVector);

      const points = [
        baseStart.clone(),  // bottom-start
        baseEnd.clone(),    // bottom-end
        topEnd.clone(),     // top-end
        topStart.clone()    // top-start
      ];

      const lines = [
        createLine(points[0], points[1]),  // bottom edge (width)
        createLine(points[1], points[2]),  // far vertical edge (height)
        createLine(points[2], points[3]),  // top edge
        createLine(points[3], points[0])   // near vertical edge (height)
      ];

      const widthCm = Math.round(getDistance(baseStart, baseEnd) * 100);
      const heightCm = Math.round(heightVector.length() * 100);

      const widthLabel = createLabel(`Width: ${widthCm} cm`, getMidpoint(points[0], points[1]));
      const heightLabel = createLabel(`Height: ${heightCm} cm`, getMidpoint(points[1], points[2]));

      const rectangle: Rectangle = {
        points,
        lines,
        widthLabel,
        heightLabel
      };

      rectangles.push(rectangle);
      return rectangle;
    };

    // Draw the given segments using the pool of preview lines, growing the pool
    // as needed and hiding any leftovers from a previous frame.
    const updatePreview = (segments: Array<[THREE.Vector3, THREE.Vector3]>) => {
      while (previewLines.length < segments.length) {
        previewLines.push(createLine(new THREE.Vector3(), new THREE.Vector3()));
      }
      previewLines.forEach((line, i) => {
        if (i < segments.length) {
          line.visible = true;
          updateLine(line, segments[i][0], segments[i][1]);
        } else {
          line.visible = false;
        }
      });
    };

    const clearPreview = () => {
      previewLines.forEach((line) => {
        scene.remove(line);
        line.geometry.dispose();
      });
      previewLines = [];
    };

    // Clear the in-progress shape state so a brand new height can be set.
    const resetShape = () => {
      heightPoints = [];
      heightVector = null;
      firstBasePoint = null;
      lastBasePoint = null;
      wallCount = 0;
      clearPreview();
    };

    const onSelect = () => {
      if (!reticle.visible) return;

      const point = new THREE.Vector3();
      point.setFromMatrixPosition(reticle.matrix);

      // Phase 1: the first two taps set the height.
      if (heightPoints.length < 2) {
        heightPoints.push(point.clone());

        if (heightPoints.length === 2) {
          heightVector = heightPoints[1].clone().sub(heightPoints[0]);
          // Persist the height line itself.
          createLine(heightPoints[0], heightPoints[1]);
          // The bottom of the height line is the first base corner; the loop
          // will eventually close back to it.
          firstBasePoint = heightPoints[0].clone();
          lastBasePoint = heightPoints[0].clone();
          wallCount = 0;
        }
        return;
      }

      // Phase 2: every further tap drops a base corner and draws a wall from the
      // previous corner to it.
      createWall(lastBasePoint!, point);
      lastBasePoint = point.clone();
      wallCount++;

      // After the 3rd base corner (the 5th tap overall), automatically close the
      // loop back to the first corner and finish this shape.
      if (wallCount === 3) {
        createWall(lastBasePoint!, firstBasePoint!);
        resetShape();
      }
    };

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const toScreenPosition = (point: THREE.Vector3, camera: THREE.Camera) => {
      const vec = new THREE.Vector3();
      vec.copy(point);
      vec.project(camera);

      vec.x = (vec.x + 1) * window.innerWidth / 2;
      vec.y = (-vec.y + 1) * window.innerHeight / 2;
      vec.z = 0;

      return vec;
    };

    const animate = () => {
      renderer.setAnimationLoop(render);
    };

    const render = (_timestamp: number | null, frame: any) => {
      if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session: any = renderer.xr.getSession();

        if (session && !hitTestSourceRequested) {
          session.requestReferenceSpace('viewer').then((refSpace: any) => {
            if (session.requestHitTestSource) {
              session
                .requestHitTestSource({ space: refSpace })
                .then((source: any) => {
                  hitTestSource = source;
                });
            }
          });
        }

        if (hitTestSource) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);

          if (hitTestResults.length) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace!);

            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);

              // Preview what the next tap will create.
              const previewPoint = new THREE.Vector3();
              previewPoint.setFromMatrixPosition(reticle.matrix);

              if (heightPoints.length === 1) {
                // Still drawing the height line: preview a single segment.
                updatePreview([[heightPoints[0], previewPoint]]);
              } else if (heightVector && lastBasePoint && wallCount < 3) {
                // Preview the whole next wall (base, both verticals and top).
                const a = lastBasePoint;
                const b = previewPoint;
                const aTop = a.clone().add(heightVector);
                const bTop = b.clone().add(heightVector);
                updatePreview([
                  [a, b],        // bottom edge
                  [b, bTop],     // far vertical
                  [bTop, aTop],  // top edge
                  [aTop, a],     // near vertical
                ]);
              } else {
                // Nothing to preview yet (e.g. waiting for the first tap).
                updatePreview([]);
              }
            }
          } else {
            reticle.visible = false;
          }
        }

        // Keep all labels glued to their 3D anchor points on screen.
        const allLabels = rectangles.flatMap(rect =>
          [rect.widthLabel, rect.heightLabel].filter(Boolean)
        ) as Label[];

        allLabels.forEach((label) => {
          const camera3D = renderer.xr.getCamera();
          const pos = toScreenPosition(label.point, camera3D);
          label.div.style.transform = `translate(-50%, -50%) translate(${pos.x}px,${pos.y}px)`;
        });
      }

      renderer.render(scene, camera);
    };

    init();

    return () => {
      // Cleanup
      renderer?.dispose();
      scene?.clear();

      // Remove all labels
      const allLabels = rectangles.flatMap(rect =>
        [rect.widthLabel, rect.heightLabel].filter(Boolean)
      ) as Label[];

      allLabels.forEach((label) => label.div.remove());

      const button = document.querySelector('button');
      button?.remove();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-screen relative">
      {!isARSupported && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 text-white text-center p-4">
          <p className="text-xl">WebXR is not supported on your device</p>
        </div>
      )}
      <style>
        {`
          .label {
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
          }
        `}
      </style>
    </div>
  );
};
