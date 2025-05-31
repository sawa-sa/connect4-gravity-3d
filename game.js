// --- 定数とグローバル変数 ---
const GRID = 4;
let gravity = new THREE.Vector3(0, -1, 0);
let currentPlayer = 1;
const colors = [0x000000, 0xff4444, 0x4444ff];

let board = [];
let ghostPoles = [];

let scene, camera, renderer, raycaster, controls;
let gameGroup;
let previewSphere;
let uiControlsDisabled = false;

let highlightPlane;

let homeCameraPosition = new THREE.Vector3();
let homeControlsTarget = new THREE.Vector3();
let isReturningToHomeView = false;

const POLE_RADIUS = 0.05;
const GHOST_POLE_RADIUS_FACTOR = 0.7;
const GHOST_POLE_OPACITY = 0.15;

let columnHighlightMesh;
let selectedCellForPlacement = null;

// --- 初期化とメインループ ---
initBoard();
initScene();
animate();

/**
 * ゲーム盤と関連変数を初期化する関数
 */
function initBoard() {
  board = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(0)));
  ghostPoles = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(null)));
  currentPlayer = 1;
  gravity.set(0, -1, 0);
  selectedCellForPlacement = null;
}

/**
 * 3Dシーンを初期化する関数
 */
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x333333);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, GRID * 1.5, GRID * 3);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('container').appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;

  homeCameraPosition.copy(camera.position);
  homeControlsTarget.copy(controls.target);
  controls.addEventListener('start', onDragStart);

  raycaster = new THREE.Raycaster();

  const ambientLight = new THREE.AmbientLight(0x606060);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
  directionalLight.position.set(GRID * 0.75, GRID * 1.5, GRID * 1);
  directionalLight.castShadow = true;
  const shadowCamSize = GRID * 2;
  directionalLight.shadow.camera.left = -shadowCamSize;
  directionalLight.shadow.camera.right = shadowCamSize;
  directionalLight.shadow.camera.top = shadowCamSize;
  directionalLight.shadow.camera.bottom = -shadowCamSize;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = GRID * 5;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);

  gameGroup = new THREE.Group();
  scene.add(gameGroup);

  drawGrid3D();

  const highlightGeo = new THREE.PlaneGeometry(GRID, GRID);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  highlightPlane = new THREE.Mesh(highlightGeo, highlightMat);
  highlightPlane.visible = false;
  gameGroup.add(highlightPlane);


  const groundGeo = new THREE.PlaneGeometry(GRID, GRID);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const groundPlane = new THREE.Mesh(groundGeo, groundMat);
  groundPlane.rotateX(-Math.PI / 2);
  groundPlane.position.y = -GRID / 2 - 0.01;
  groundPlane.receiveShadow = true;
  gameGroup.add(groundPlane);

  const highlightBoxGeo = new THREE.BoxGeometry(0.9, GRID - 0.05, 0.9);
  const highlightBoxMat = new THREE.MeshBasicMaterial({
    color: 0xffff99,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide
  });
  columnHighlightMesh = new THREE.Mesh(highlightBoxGeo, highlightBoxMat);
  columnHighlightMesh.receiveShadow = false;
  columnHighlightMesh.castShadow = false;
  columnHighlightMesh.visible = false;
  gameGroup.add(columnHighlightMesh);

  createInitialGhostPoles();

  const previewGeo = new THREE.SphereGeometry(0.4, 32, 16);
  const previewMat = new THREE.MeshStandardMaterial({ opacity: 0.6, transparent: true });
  previewSphere = new THREE.Mesh(previewGeo, previewMat);
  previewSphere.visible = false;
  gameGroup.add(previewSphere);

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  document.getElementById('resetButton').addEventListener('click', resetGame);
  document.getElementById('resetViewButton').addEventListener('click', resetView);
  document.getElementById('instructionsButton').addEventListener('click', () => toggleInstructions(true));

  const buttons = [
    { id: 'btnRollLeft', axis: new THREE.Vector3(0, 0, 1), angle: Math.PI / 2 },
    { id: 'btnRollRight', axis: new THREE.Vector3(0, 0, 1), angle: -Math.PI / 2 },
    { id: 'btnTiltFwd', axis: new THREE.Vector3(1, 0, 0), angle: -Math.PI / 2 },
    { id: 'btnTiltBack', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI / 2 },
    { id: 'btnFlip', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI }
  ];

  buttons.forEach(btnInfo => {
    const buttonElement = document.getElementById(btnInfo.id);
    if (buttonElement) {
      buttonElement.addEventListener('mouseenter', () => showHighlight(btnInfo.axis, btnInfo.angle));
      buttonElement.addEventListener('mouseleave', hideHighlight);
    }
  });

  updateStatus();
}

/**
 * 回転後の底面をハイライト表示する
 * @param {THREE.Vector3} rotationAxis 回転軸
 * @param {number} angle 回転角度
 */
function showHighlight(rotationAxis, angle) {
  if (uiControlsDisabled) return;

  // 1. ボタンの回転を適用した場合の、キューブの未来の向きを計算
  const currentQuaternion = gameGroup.quaternion.clone();
  const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
  const targetQuaternion = currentQuaternion.multiply(rotationQuaternion);

  // 2. 未来の向きから、どのローカル方向が「下」になるか計算
  const worldDown = new THREE.Vector3(0, -1, 0);
  let newLocalGravity = worldDown.clone().applyQuaternion(targetQuaternion.clone().invert());

  // 3. 計算結果を最も近い軸方向に丸める (例: (0.99, 0.1, 0) -> (1, 0, 0))
  let absX = Math.abs(newLocalGravity.x);
  let absY = Math.abs(newLocalGravity.y);
  let absZ = Math.abs(newLocalGravity.z);
  let maxVal = Math.max(absX, absY, absZ);

  if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0);
  else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0);
  else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z));

  // 4. 新しい「下」方向に基づいてハイライト平面の位置と向きを決定
  highlightPlane.rotation.set(0, 0, 0); // 回転をリセット
  const halfGrid = GRID / 2 + 0.01; // グリッド線とのZ-fightingを防止

  if (newLocalGravity.x === 1) { // 右面が底に
    highlightPlane.position.set(halfGrid, 0, 0);
    highlightPlane.rotation.y = -Math.PI / 2;
  } else if (newLocalGravity.x === -1) { // 左面が底に
    highlightPlane.position.set(-halfGrid, 0, 0);
    highlightPlane.rotation.y = Math.PI / 2;
  } else if (newLocalGravity.y === 1) { // 上面が底に
    highlightPlane.position.set(0, halfGrid, 0);
    highlightPlane.rotation.x = Math.PI / 2;
  } else if (newLocalGravity.y === -1) { // 下面が底に
    highlightPlane.position.set(0, -halfGrid, 0);
    highlightPlane.rotation.x = -Math.PI / 2;
  } else if (newLocalGravity.z === 1) { // 奥面が底に
    highlightPlane.position.set(0, 0, halfGrid);
    highlightPlane.rotation.y = 0;
  } else if (newLocalGravity.z === -1) { // 手前面が底に
    highlightPlane.position.set(0, 0, -halfGrid);
    highlightPlane.rotation.y = Math.PI;
  }

  highlightPlane.visible = true;
}

/**
 * ハイライトを非表示にする
 */
function hideHighlight() {
  highlightPlane.visible = false;
}


/**
 * 初期ゴーストポールを全セルに作成する関数
 */
function createInitialGhostPoles() {
  const ghostPoleMat = new THREE.MeshStandardMaterial({
    color: 0x999999,
    transparent: true,
    opacity: GHOST_POLE_OPACITY,
    metalness: 0.0,
    roughness: 0.9
  });

  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, 1, 6);
        const ghostPole = new THREE.Mesh(poleGeo, ghostPoleMat.clone());
        ghostPole.castShadow = false;
        ghostPole.receiveShadow = false;
        ghostPole.userData.isGhostPole = true;
        ghostPole.userData.boardX = x;
        ghostPole.userData.boardY = y;
        ghostPole.userData.boardZ = z;

        updateSingleGhostPole(ghostPole, x, y, z, gravity);
        ghostPole.visible = (board[y][z][x] === 0);

        gameGroup.add(ghostPole);
        ghostPoles[y][z][x] = ghostPole;
      }
    }
  }
}

/**
 * 特定のゴーストポールの形状（長さ、位置、向き）を更新する関数
 */
function updateSingleGhostPole(ghostPole, boardX, boardY, boardZ, currentGravityVec) {
  const { axis, dir } = getGravityAxisAndDirFromVec(currentGravityVec);
  const cellCenter = get3DPosition(boardX, boardY, boardZ);

  const poleLength = 1.0;
  const validPoleLength = Math.max(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR * 2, poleLength);

  ghostPole.geometry.dispose();
  ghostPole.geometry = new THREE.CylinderGeometry(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, validPoleLength, 6);

  ghostPole.position.copy(cellCenter);
  ghostPole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), currentGravityVec.clone().negate());
}

/**
 * 全てのゴーストポールの表示/非表示と形状を更新する関数
 */
function updateAllGhostPolesVisibilityAndTransform() {
  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const ghostPole = ghostPoles[y][z][x];
        if (board[y][z][x] === 0) {
          updateSingleGhostPole(ghostPole, x, y, z, gravity);
          ghostPole.visible = true;
        } else {
          ghostPole.visible = false;
        }
      }
    }
  }
}


/**
 * グリッド線（外枠と内部線）を描画する関数
 */
function drawGrid3D() {
  const halfGrid = GRID / 2.0;
  const outerBoxGeo = new THREE.BoxGeometry(GRID, GRID, GRID);
  const outerEdges = new THREE.EdgesGeometry(outerBoxGeo);
  const outerLines = new THREE.LineSegments(outerEdges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
  outerLines.castShadow = false;
  outerLines.receiveShadow = false;
  gameGroup.add(outerLines);

  const innerLinesMaterial = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.3 });
  const innerPoints = [];
  for (let i = 1; i < GRID; i++) {
    const coord = -halfGrid + i;
    innerPoints.push(new THREE.Vector3(-halfGrid, coord, -halfGrid), new THREE.Vector3(halfGrid, coord, -halfGrid));
    innerPoints.push(new THREE.Vector3(-halfGrid, coord, halfGrid), new THREE.Vector3(halfGrid, coord, halfGrid));
    innerPoints.push(new THREE.Vector3(-halfGrid, -halfGrid, coord), new THREE.Vector3(halfGrid, -halfGrid, coord));
    innerPoints.push(new THREE.Vector3(-halfGrid, halfGrid, coord), new THREE.Vector3(halfGrid, halfGrid, coord));
    innerPoints.push(new THREE.Vector3(coord, -halfGrid, -halfGrid), new THREE.Vector3(coord, halfGrid, -halfGrid));
    innerPoints.push(new THREE.Vector3(coord, -halfGrid, halfGrid), new THREE.Vector3(coord, halfGrid, halfGrid));
    innerPoints.push(new THREE.Vector3(-halfGrid, -halfGrid, coord), new THREE.Vector3(-halfGrid, halfGrid, coord));
    innerPoints.push(new THREE.Vector3(halfGrid, -halfGrid, coord), new THREE.Vector3(halfGrid, halfGrid, coord));
    innerPoints.push(new THREE.Vector3(coord, -halfGrid, -halfGrid), new THREE.Vector3(coord, -halfGrid, halfGrid));
    innerPoints.push(new THREE.Vector3(coord, halfGrid, -halfGrid), new THREE.Vector3(coord, halfGrid, halfGrid));
    innerPoints.push(new THREE.Vector3(-halfGrid, coord, -halfGrid), new THREE.Vector3(-halfGrid, coord, halfGrid));
    innerPoints.push(new THREE.Vector3(halfGrid, coord, -halfGrid), new THREE.Vector3(halfGrid, coord, halfGrid));
  }
  const uniquePointPairs = new Set();
  const finalInnerPoints = [];
  for (let i = 0; i < innerPoints.length; i += 2) {
    const p1 = innerPoints[i];
    const p2 = innerPoints[i + 1];
    const key1 = [p1, p2].map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).sort().join('-');
    if (!uniquePointPairs.has(key1)) {
      uniquePointPairs.add(key1);
      finalInnerPoints.push(p1, p2);
    }
  }
  if (finalInnerPoints.length > 0) {
    const innerGeometry = new THREE.BufferGeometry().setFromPoints(finalInnerPoints);
    const innerLineSegments = new THREE.LineSegments(innerGeometry, innerLinesMaterial);
    innerLineSegments.castShadow = false;
    innerLineSegments.receiveShadow = false;
    gameGroup.add(innerLineSegments);
  }
}

/**
 * 駒の座標をボード座標から3D座標に変換 (gameGroupローカル座標)
 */
function get3DPosition(x, y, z) {
  return new THREE.Vector3(x - GRID / 2 + 0.5, y - GRID / 2 + 0.5, z - GRID / 2 + 0.5);
}

/**
 * 駒とサポートポールを作成し、落下アニメーションを実行する関数
 */
function animateDrop(x, y, z, player) {
  const targetPos = get3DPosition(x, y, z);
  const startPos = targetPos.clone().sub(gravity.clone().multiplyScalar(GRID));

  const sphereGeo = new THREE.SphereGeometry(0.4, 32, 16);
  const sphereMat = new THREE.MeshStandardMaterial({ color: colors[player], metalness: 0.3, roughness: 0.4 });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  sphere.position.copy(startPos);
  sphere.castShadow = true;
  sphere.receiveShadow = false;
  sphere.userData.isPiece = true;
  sphere.userData.boardX = x;
  sphere.userData.boardY = y;
  sphere.userData.boardZ = z;
  gameGroup.add(sphere);

  const pole = createSupportPole(sphere);
  sphere.userData.pole = pole;
  gameGroup.add(pole);

  if (ghostPoles[y] && ghostPoles[y][z] && ghostPoles[y][z][x]) {
    ghostPoles[y][z][x].visible = false;
  }

  animateMotion(sphere, targetPos, () => {
    updateSupportPole(sphere, pole);
    pole.visible = true;
  });
}

/**
 * サポートポールを作成する関数
 */
function createSupportPole(pieceMesh) {
  const piecePos = pieceMesh.position;
  const cellCenter = get3DPosition(pieceMesh.userData.boardX, pieceMesh.userData.boardY, pieceMesh.userData.boardZ);
  const { axis, dir } = getGravityAxisAndDir();

  let poleLength = 0.01;

  const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, poleLength, 8);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x999999,
    transparent: true,
    opacity: GHOST_POLE_OPACITY,
    metalness: 0.0,
    roughness: 0.9
  });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.castShadow = true;
  pole.receiveShadow = false;
  pole.userData.isPole = true;
  pole.visible = false;

  return pole;
}

/**
 * サポートポールの位置、長さ、向きを更新する関数
 */
function updateSupportPole(pieceMesh, poleMesh) {
  const piecePos = pieceMesh.position;
  const cellCenter = get3DPosition(pieceMesh.userData.boardX, pieceMesh.userData.boardY, pieceMesh.userData.boardZ);
  const { axis, dir } = getGravityAxisAndDir();

  const cellBottomPlaneCoord = cellCenter[axis] - 0.5 * dir;
  let poleLength = Math.abs(piecePos[axis] - cellBottomPlaneCoord);
  poleLength = Math.max(POLE_RADIUS * 2, poleLength);

  poleMesh.geometry.dispose();
  poleMesh.geometry = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, poleLength, 8);

  const poleCenterOnAxis = (piecePos[axis] + cellBottomPlaneCoord) / 2;
  const poleCenterPos = piecePos.clone();
  poleCenterPos[axis] = poleCenterOnAxis;
  poleMesh.position.copy(poleCenterPos);

  poleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate());
}


/**
 * マウスカーソル位置の3D座標を取得する関数 (gameGroupローカル座標)
 */
function getIntersectPoint(event) {
  if (uiControlsDisabled) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(mouse, camera);

  const invMatrix = new THREE.Matrix4().copy(gameGroup.matrixWorld).invert();
  const localRay = new THREE.Ray().copy(raycaster.ray).applyMatrix4(invMatrix);

  const boundingBox = new THREE.Box3(
    new THREE.Vector3(-GRID / 2, -GRID / 2, -GRID / 2),
    new THREE.Vector3(GRID / 2, GRID / 2, GRID / 2)
  );
  return localRay.intersectBox(boundingBox, new THREE.Vector3());
}

/**
 * クリック時の処理 (2段階配置)
 */
function onClick(event) {
  if (uiControlsDisabled) return;
  const point = getIntersectPoint(event);
  let clickedLandingCell = null;

  if (point) {
    const { axis: gravityAxis, dir: gravityDir } = getGravityAxisAndDir();
    let cX, cY, cZ;
    if (gravityAxis === 'y') {
      cX = Math.floor(point.x + GRID / 2); cZ = Math.floor(point.z + GRID / 2);
    } else if (gravityAxis === 'x') {
      cY = Math.floor(point.y + GRID / 2); cZ = Math.floor(point.z + GRID / 2);
    } else {
      cX = Math.floor(point.x + GRID / 2); cY = Math.floor(point.y + GRID / 2);
    }

    for (let i = 0; i < GRID; i++) {
      const w = (gravityDir === -1) ? i : GRID - 1 - i;
      const checkPos = {};
      if (gravityAxis === 'y') { checkPos.x = cX; checkPos.y = w; checkPos.z = cZ; }
      else if (gravityAxis === 'x') { checkPos.x = w; checkPos.y = cY; checkPos.z = cZ; }
      else { checkPos.x = cX; checkPos.y = cY; checkPos.z = w; }

      if (checkPos.x >= 0 && checkPos.x < GRID && checkPos.y >= 0 && checkPos.y < GRID && checkPos.z >= 0 && checkPos.z < GRID) {
        if (board[checkPos.y][checkPos.z][checkPos.x] === 0) {
          clickedLandingCell = { boardX: checkPos.x, boardY: checkPos.y, boardZ: checkPos.z };
          break;
        }
      }
    }
  }

  if (selectedCellForPlacement) {
    if (clickedLandingCell &&
      clickedLandingCell.boardX === selectedCellForPlacement.boardX &&
      clickedLandingCell.boardY === selectedCellForPlacement.boardY &&
      clickedLandingCell.boardZ === selectedCellForPlacement.boardZ) {
      placePieceInternal(selectedCellForPlacement.boardX, selectedCellForPlacement.boardY, selectedCellForPlacement.boardZ);
    } else if (clickedLandingCell) {
      selectedCellForPlacement = clickedLandingCell;
      updatePreviewsForSelection();
    } else {
      selectedCellForPlacement = null;
      hidePreviews();
    }
  } else {
    if (clickedLandingCell) {
      selectedCellForPlacement = clickedLandingCell;
      updatePreviewsForSelection();
    }
  }
  updateStatus();
}

/**
 * 選択状態に基づいてプレビューとハイライトを更新する関数
 */
function updatePreviewsForSelection() {
  if (selectedCellForPlacement) {
    const { boardX, boardY, boardZ } = selectedCellForPlacement;
    previewSphere.position.copy(get3DPosition(boardX, boardY, boardZ));
    previewSphere.material.color.set(colors[currentPlayer]);
    previewSphere.visible = true;

    const { axis: gravityAxis } = getGravityAxisAndDir();
    const columnCenter = new THREE.Vector3();
    if (gravityAxis === 'y') {
      columnCenter.set(get3DPosition(boardX, 0, boardZ).x, 0, get3DPosition(boardX, 0, boardZ).z);
    } else if (gravityAxis === 'x') {
      columnCenter.set(0, get3DPosition(0, boardY, boardZ).y, get3DPosition(0, boardY, boardZ).z);
    } else {
      columnCenter.set(get3DPosition(boardX, boardY, 0).x, get3DPosition(boardX, boardY, 0).y, 0);
    }
    columnHighlightMesh.position.copy(columnCenter);
    columnHighlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate());
    columnHighlightMesh.visible = true;
  }
}

/**
 * プレビューとハイライトを非表示にする関数
 */
function hidePreviews() {
  previewSphere.visible = false;
  columnHighlightMesh.visible = false;
}


/**
 * マウス移動時の処理
 */
function onMouseMove(event) {
  if (selectedCellForPlacement) {
    return;
  }
  const point = getIntersectPoint(event);
  if (point) {
    const { axis: gravityAxis, dir: gravityDir } = getGravityAxisAndDir();
    let cX, cY, cZ;
    if (gravityAxis === 'y') { cX = Math.floor(point.x + GRID / 2); cZ = Math.floor(point.z + GRID / 2); }
    else if (gravityAxis === 'x') { cY = Math.floor(point.y + GRID / 2); cZ = Math.floor(point.z + GRID / 2); }
    else { cX = Math.floor(point.x + GRID / 2); cY = Math.floor(point.y + GRID / 2); }

    let landingCellFound = false;
    for (let i = 0; i < GRID; i++) {
      const w = (gravityDir === -1) ? i : GRID - 1 - i;
      const checkPos = {};
      if (gravityAxis === 'y') { checkPos.x = cX; checkPos.y = w; checkPos.z = cZ; }
      else if (gravityAxis === 'x') { checkPos.x = w; checkPos.y = cY; checkPos.z = cZ; }
      else { checkPos.x = cX; checkPos.y = cY; checkPos.z = w; }

      if (checkPos.x >= 0 && checkPos.x < GRID && checkPos.y >= 0 && checkPos.y < GRID && checkPos.z >= 0 && checkPos.z < GRID) {
        if (board[checkPos.y][checkPos.z][checkPos.x] === 0) {
          previewSphere.position.copy(get3DPosition(checkPos.x, checkPos.y, checkPos.z));
          previewSphere.material.color.set(colors[currentPlayer]);
          previewSphere.visible = true;
          landingCellFound = true;

          const columnCenter = new THREE.Vector3();
          if (gravityAxis === 'y') { columnCenter.set(get3DPosition(checkPos.x, 0, checkPos.z).x, 0, get3DPosition(checkPos.x, 0, checkPos.z).z); }
          else if (gravityAxis === 'x') { columnCenter.set(0, get3DPosition(0, checkPos.y, checkPos.z).y, get3DPosition(0, checkPos.y, checkPos.z).z); }
          else { columnCenter.set(get3DPosition(checkPos.x, checkPos.y, 0).x, get3DPosition(checkPos.x, checkPos.y, 0).y, 0); }
          columnHighlightMesh.position.copy(columnCenter);
          columnHighlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate());
          columnHighlightMesh.visible = true;
          break;
        }
      }
    }
    if (!landingCellFound) hidePreviews();
    return;
  }
  hidePreviews();
}

/**
 * 内部的な駒配置処理 (onClickから呼び出される)
 */
function placePieceInternal(px, py, pz) {
  board[py][pz][px] = currentPlayer;
  animateDrop(px, py, pz, currentPlayer);

  selectedCellForPlacement = null;
  hidePreviews();

  if (checkWin()) return;
  switchPlayer();
}


/**
 * プレイヤーを交代する関数
 */
function switchPlayer() {
  currentPlayer = 3 - currentPlayer;
  updateStatus();
}

/**
 * 回転のヒントアニメーションを実行する関数
 */
function animateRotationHint(axis, mainRotationAngle, initialQuaternion) {
  return new Promise(resolve => {
    const hintAngle = Math.sign(mainRotationAngle) * Math.PI / 18;
    const hintSpeed = 0.25;

    const qHintTarget = initialQuaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, hintAngle));
    const qInitial = initialQuaternion.clone();

    let phase = 0;

    const loopHint = () => {
      let currentTargetQuaternion = (phase === 0) ? qHintTarget : qInitial;

      if (gameGroup.quaternion.angleTo(currentTargetQuaternion) > 0.01) {
        gameGroup.quaternion.slerp(currentTargetQuaternion, hintSpeed);
        requestAnimationFrame(loopHint);
      } else {
        gameGroup.quaternion.copy(currentTargetQuaternion);
        if (phase === 0) {
          phase = 1;
          requestAnimationFrame(loopHint);
        } else {
          resolve();
        }
      }
    };
    loopHint();
  });
}


/**
 * 立方体を回転させるメイン関数
 */
function rotateWorld(rotationAxis, angle) {
  if (uiControlsDisabled) return;
  uiControlsDisabled = true;
  isReturningToHomeView = false;
  selectedCellForPlacement = null;
  hidePreviews();

  const originalGroupQuaternion = gameGroup.quaternion.clone();

  const mainRotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
  const targetGroupQuaternion = originalGroupQuaternion.clone().multiply(mainRotationQuaternion);

  const worldDown = new THREE.Vector3(0, -1, 0);
  let newLocalGravity = worldDown.clone().applyQuaternion(targetGroupQuaternion.clone().invert());

  let absX = Math.abs(newLocalGravity.x);
  let absY = Math.abs(newLocalGravity.y);
  let absZ = Math.abs(newLocalGravity.z);
  let maxVal = Math.max(absX, absY, absZ);

  if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0);
  else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0);
  else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z));

  animateRotationHint(rotationAxis, angle, originalGroupQuaternion)
    .then(() => {
      gravity.copy(newLocalGravity);
      return animateRotation(targetGroupQuaternion);
    })
    .then(() => {
      return animateBoardUpdate();
    })
    .then(() => {
      if (checkWin()) {
        return;
      }
      switchPlayer();
      uiControlsDisabled = false;
    });
}

/**
 * gameGroupの回転アニメーション (本回転用)
 */
function animateRotation(targetQuaternion) {
  return new Promise(resolve => {
    const mainRotationSpeed = 0.15;
    const loop = () => {
      if (gameGroup.quaternion.angleTo(targetQuaternion) > 0.01) {
        gameGroup.quaternion.slerp(targetQuaternion, mainRotationSpeed);
        requestAnimationFrame(loop);
      } else {
        gameGroup.quaternion.copy(targetQuaternion);
        resolve();
      }
    };
    loop();
  });
}

/**
 * 駒とポールのスライドアニメーション (ボードデータ更新後)
 */
async function animateBoardUpdate() {
  applyGravity();
  const currentPieces = gameGroup.children.filter(obj => obj.userData.isPiece);

  const targetPieceData = [];

  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        if (board[y][z][x] !== 0) {
          targetPieceData.push({
            pos: get3DPosition(x, y, z),
            player: board[y][z][x],
            boardX: x, boardY: y, boardZ: z
          });
        }
      }
    }
  }

  const animationPromises = [];
  const unassignedPieces = [...currentPieces];

  for (const target of targetPieceData) {
    let pieceToMove = null;
    let poleToMove = null;
    let pieceIndex = -1;

    for (let i = 0; i < unassignedPieces.length; i++) {
      const piece = unassignedPieces[i];
      if (piece.material.color.getHex() === colors[target.player] &&
        piece.userData.boardX === target.boardX &&
        piece.userData.boardZ === target.boardZ) {
        pieceToMove = piece;
        poleToMove = piece.userData.pole;
        pieceIndex = i;
        break;
      }
    }
    if (!pieceToMove) {
      for (let i = 0; i < unassignedPieces.length; i++) {
        const piece = unassignedPieces[i];
        if (piece.material.color.getHex() === colors[target.player]) {
          pieceToMove = piece;
          poleToMove = piece.userData.pole;
          pieceIndex = i;
          break;
        }
      }
    }

    if (pieceToMove && poleToMove) {
      animationPromises.push(new Promise(resolve => {
        animateMotion(pieceToMove, target.pos, () => {
          updateSupportPole(pieceToMove, poleToMove);
          poleToMove.visible = true;
          resolve();
        });
      }));
      pieceToMove.userData.boardX = target.boardX;
      pieceToMove.userData.boardY = target.boardY;
      pieceToMove.userData.boardZ = target.boardZ;
      unassignedPieces.splice(pieceIndex, 1);
    }
  }

  unassignedPieces.forEach(piece => {
    if (piece.userData.pole) gameGroup.remove(piece.userData.pole);
    gameGroup.remove(piece);
  });

  await Promise.all(animationPromises);
  updateAllGhostPolesVisibilityAndTransform();
}

/**
 * 特定のメッシュをターゲット位置までアニメーションさせる汎用関数
 */
function animateMotion(mesh, targetPosition, onComplete) {
  const loop = () => {
    if (mesh.position.distanceTo(targetPosition) > 0.01) {
      mesh.position.lerp(targetPosition, 0.15);
      if (mesh.userData.isPiece && mesh.userData.pole) {
        updateSupportPole(mesh, mesh.userData.pole);
      }
      requestAnimationFrame(loop);
    } else {
      mesh.position.copy(targetPosition);
      if (onComplete) onComplete();
    }
  };
  loop();
}

/**
 * 現在のローカル重力方向に合わせて盤上の駒を再配置する関数 (ボードデータを更新)
 */
function applyGravity() {
  const { axis, dir } = getGravityAxisAndDir();
  const newBoard = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(0)));

  const u_axis = axis === 'x' ? 'y' : 'x';
  const v_axis = axis === 'z' ? (axis === 'x' ? 'z' : 'y') : 'z';

  for (let u = 0; u < GRID; u++) {
    for (let v = 0; v < GRID; v++) {
      const line = [];
      for (let w_scan = 0; w_scan < GRID; w_scan++) {
        const pos = {};
        pos[u_axis] = u; pos[v_axis] = v; pos[axis] = w_scan;

        if (board[pos.y][pos.z][pos.x] !== 0) {
          if (dir === -1) {
            line.push(board[pos.y][pos.z][pos.x]);
          } else {
            line.unshift(board[pos.y][pos.z][pos.x]);
          }
        }
      }

      for (let i = 0; i < line.length; i++) {
        const w_fill = (dir === -1) ? i : GRID - 1 - i;
        const pos_fill = {};
        pos_fill[u_axis] = u; pos_fill[v_axis] = v; pos_fill[axis] = w_fill;
        newBoard[pos_fill.y][pos_fill.z][pos_fill.x] = line[i];
      }
    }
  }
  board = newBoard;
}


/**
 * 勝敗を判定する関数
 */
let highlightSpheres = [];

function checkWin() {
  const directions = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]
  ];

  let count1 = 0;
  let count2 = 0;
  const visited = new Set();
  const lines1 = [];
  const lines2 = [];

  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const player = board[y][z][x];
        if (player === 0) continue;

        for (const [dx, dy, dz] of directions) {
          let positions = [];
          let valid = true;
          for (let i = 0; i < 4; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            const nz = z + dz * i;
            if (nx < 0 || ny < 0 || nz < 0 || nx >= GRID || ny >= GRID || nz >= GRID) {
              valid = false;
              break;
            }
            if (board[ny][nz][nx] !== player) {
              valid = false;
              break;
            }
            positions.push({ x: nx, y: ny, z: nz });
          }

          const key = positions.map(p => `${p.x},${p.y},${p.z}`).sort().join('|');
          if (valid && !visited.has(key)) {
            visited.add(key);
            if (player === 1) {
              count1++;
              lines1.push(positions);
            } else {
              count2++;
              lines2.push(positions);
            }
          }
        }
      }
    }
  }

  highlightLines(lines1);
  highlightLines(lines2);

  // ★ MODIFIED: 不要なライン数表示を削除
  const statusElem = document.getElementById("status");

  if (count1 > 0 || count2 > 0) {
    let message = "";
    let winnerHexColor = "#FFFF00";

    if (count1 > count2) {
      message = `Red wins with ${count1} line(s)!`;
      winnerHexColor = "#" + colors[1].toString(16).padStart(6, '0');
    } else if (count2 > count1) {
      message = `Blue wins with ${count2} line(s)!`;
      winnerHexColor = "#" + colors[2].toString(16).padStart(6, '0');
    } else {
      message = `Draw! Both players have ${count1} line(s).`;
    }
    alert(message);
    if (statusElem) {
      statusElem.innerHTML = `<strong style="color: ${winnerHexColor};">${message}</strong>`;
    }
    disableButtons();
    return true;
  }
  return false;
}

function highlightLines(lines) {
  lines.forEach(positions => {
    positions.forEach(({ x, y, z }) => {
      const foundPiece = gameGroup.children.find(obj =>
        obj.userData.isPiece &&
        obj.userData.boardX === x &&
        obj.userData.boardY === y &&
        obj.userData.boardZ === z
      );
      if (foundPiece && foundPiece.material) {
        foundPiece.material.emissive.copy(foundPiece.material.color);
        foundPiece.material.emissiveIntensity = 1.0;
        highlightSpheres.push(foundPiece);
      }
    });
  });
}

function disableButtons() {
  const buttons = document.querySelectorAll('#ui button');
  buttons.forEach(btn => {
    if (btn.id !== 'resetButton' && btn.id !== 'resetViewButton') {
      btn.disabled = true;
    }
  });
  uiControlsDisabled = true;
}

function enableButtons() {
  const buttons = document.querySelectorAll('#ui button');
  buttons.forEach(btn => {
    btn.disabled = false;
  });
  uiControlsDisabled = false;
}

function clearHighlightSpheres() {
  highlightSpheres.forEach(sphere => {
    if (sphere.material) {
      sphere.material.emissive.set(0x000000);
      sphere.material.emissiveIntensity = 0;
    }
  });
  highlightSpheres = [];
}




/**
 * ヘルパー関数: 現在のローカル重力ベクトルから主軸と方向を取得
 */
function getGravityAxisAndDir() {
  return getGravityAxisAndDirFromVec(gravity);
}

/**
 * ヘルパー関数: 指定された重力ベクトルから主軸と方向を取得
 */
function getGravityAxisAndDirFromVec(gravityVector) {
  let axis = 'y';
  if (Math.abs(gravityVector.x) > Math.abs(gravityVector.y) && Math.abs(gravityVector.x) > Math.abs(gravityVector.z)) axis = 'x';
  else if (Math.abs(gravityVector.z) > Math.abs(gravityVector.y)) axis = 'z';

  const dir = Math.sign(gravityVector[axis]);
  return { axis, dir };
}

/**
 * ゲームをリセットする関数
 */
function resetGame() {
  if (uiControlsDisabled && !document.getElementById('resetButton').disabled) {
  } else if (uiControlsDisabled) {
    return;
  }

  isReturningToHomeView = false;
  selectedCellForPlacement = null;
  hidePreviews();
  clearHighlightSpheres();
  enableButtons();

  const targetQuaternion = new THREE.Quaternion();
  animateRotation(targetQuaternion).then(() => {
    const objectsToRemove = gameGroup.children.filter(obj => obj.userData.isPiece || obj.userData.isPole || obj.userData.isGhostPole);
    objectsToRemove.forEach(obj => {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });

    initBoard();
    createInitialGhostPoles();
    updateAllGhostPolesVisibilityAndTransform();

    updateStatus();
    isReturningToHomeView = true;
  });
}

/**
 * 画面上のステータス表示を更新する関数
 */
function updateStatus() {
  if (uiControlsDisabled && !document.getElementById('resetButton').disabled) {
    return
  }
  const playerColor = currentPlayer === 1 ? 'Red' : 'Blue';
  const playerHexColor = currentPlayer === 1 ? colors[1].toString(16).padStart(6, '0') : colors[2].toString(16).padStart(6, '0');
  //const gravStr = `(${gravity.x.toFixed(0)}, ${gravity.y.toFixed(0)}, ${gravity.z.toFixed(0)})`;
  let statusText = `Player: <strong style="color: #${playerHexColor}">${playerColor}</strong>`;
  if (selectedCellForPlacement) {
    statusText += " | Click again on highlighted column to place piece.";
  }
  document.getElementById('status').innerHTML = statusText;
}

/**
 * ウィンドウリサイズ時の処理
 */
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * OrbitControlsのドラッグ開始時に呼ばれる関数
 */
function onDragStart() {
  isReturningToHomeView = false;
}

/**
 * 「視点をリセット」ボタンが押されたときに呼ばれる関数
 */
function resetView() {
  isReturningToHomeView = true;
}

/**
 * 説明表示をトグルする関数
 */
function toggleInstructions(show) {
  const modal = document.getElementById('instructionsModal');
  if (modal) {
    modal.style.display = show ? 'flex' : 'none';
    uiControlsDisabled = show;
    if (show) {
      isReturningToHomeView = false;
      selectedCellForPlacement = null;
      hidePreviews();
      updateStatus();
    }
  }
}


/**
 * アニメーションループ
 */
function animate() {
  requestAnimationFrame(animate);

  if (isReturningToHomeView) {
    camera.position.lerp(homeCameraPosition, 0.1);
    controls.target.lerp(homeControlsTarget, 0.1);

    if (camera.position.distanceTo(homeCameraPosition) < 0.01 && controls.target.distanceTo(homeControlsTarget) < 0.01) {
      camera.position.copy(homeCameraPosition);
      controls.target.copy(homeControlsTarget);
      isReturningToHomeView = false;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}