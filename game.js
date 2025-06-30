// --- ゲームモード設定 ---
const gameModes = {
  classic: {
    name: "Classic (4x4, 4-to-win)",
    gridSize: 4,
    winLength: 4,
    initialShifts: 3,
    shiftCooldown: 2,
    shiftEndsTurn: true,
  },
  tinyCube: {
    name: "Tiny Cube (3x3, 3-to-win)",
    gridSize: 3,
    winLength: 3,
    initialShifts: 2,
    shiftCooldown: 1,
    shiftEndsTurn: true,
  },
  shiftMania: {
    name: "Shift Mania",
    gridSize: 4,
    winLength: 4,
    initialShifts: 10,
    shiftCooldown: 0,
    shiftEndsTurn: true,
  },
  noShift: {
    name: "No-Shift",
    gridSize: 4,
    winLength: 4,
    initialShifts: 0,
    shiftCooldown: 0,
    shiftEndsTurn: true, // trueでも実質影響なし
  },
  expert: {
    name: "Expert (Shift & Place)",
    gridSize: 4,
    winLength: 4,
    initialShifts: 1,
    shiftCooldown: 0,
    shiftEndsTurn: false,
  }
};
let currentGameConfig;

// --- グローバル変数 ---
let GRID; // ゲームモードによって設定される
const colors = [0x000000, 0xff4444, 0x4444ff]; // Black (unused), Red, Blue
let gravity = new THREE.Vector3(0, -1, 0);
let currentPlayer = 1;
let shiftCounts = {};
let shiftCooldowns = {};
let board = [];
let ghostPoles = [];
let history = [];
let highlightSpheres = [];

// --- 3D関連のグローバル変数 ---
let scene, camera, renderer, raycaster, controls;
let gameGroup; // ゲームオブジェクト（キューブ、駒など）をまとめるグループ
let previewSphere;
let highlightPlane;
let columnHighlightMesh;
let homeCameraPosition = new THREE.Vector3();
let homeControlsTarget = new THREE.Vector3();

// --- 状態管理のグローバル変数 ---
let uiControlsDisabled = false;
let isGameOver = false;
let isReturningToHomeView = false;
let selectedCellForPlacement = null;
let selectedRotation = null;

// ★ ADDED: CPU-related state
let player2IsCPU = false;
let cpuDifficulty = 'medium';


const POLE_RADIUS = 0.05;
const GHOST_POLE_RADIUS_FACTOR = 0.7;
const GHOST_POLE_OPACITY = 0.15;

// --- 初期化とメインループ ---
initScene(); // 3Dシーンの基本設定を先に行う
animate();   // アニメーションループを開始

/**
 * 3Dシーンの基本的な設定を行う関数 (初回実行時のみ)
 */
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x333333);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('container').appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;

  raycaster = new THREE.Raycaster();

  const ambientLight = new THREE.AmbientLight(0x606060);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  const shadowCamSize = 10;
  directionalLight.shadow.camera.left = -shadowCamSize;
  directionalLight.shadow.camera.right = shadowCamSize;
  directionalLight.shadow.camera.top = shadowCamSize;
  directionalLight.shadow.camera.bottom = -shadowCamSize;
  scene.add(directionalLight);

  const highlightGeo = new THREE.PlaneGeometry(1, 1);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  highlightPlane = new THREE.Mesh(highlightGeo, highlightMat);
  highlightPlane.visible = false;

  const highlightBoxGeo = new THREE.BoxGeometry(0.9, 1, 0.9);
  const highlightBoxMat = new THREE.MeshBasicMaterial({ color: 0xffff99, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
  columnHighlightMesh = new THREE.Mesh(highlightBoxGeo, highlightBoxMat);
  columnHighlightMesh.visible = false;

  const previewGeo = new THREE.SphereGeometry(0.4, 32, 16);
  const previewMat = new THREE.MeshStandardMaterial({ opacity: 0.6, transparent: true });
  previewSphere = new THREE.Mesh(previewGeo, previewMat);
  previewSphere.visible = false;

  // --- イベントリスナーの設定 ---
  document.getElementById('startGameButton').addEventListener('click', startGame);
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });

  document.getElementById('backToMenuButton').addEventListener('click', () => {
    showConfirmDialog("Are you sure you want to return to the menu? The current game will be lost.", showMenu);
  });

  document.getElementById('resetGameButton').addEventListener('click', resetGame);
  document.getElementById('resetViewButton').addEventListener('click', resetView);
  document.getElementById('undoButton').addEventListener('click', undoMove);
  document.getElementById('instructionsButton').addEventListener('click', () => toggleInstructions(true));

  document.getElementById('opponentSelector').addEventListener('change', (e) => {
    document.getElementById('cpuDifficultyContainer').style.display = e.target.value === 'cpu' ? 'flex' : 'none';
  });


  const rotateButtons = [
    { id: 'btnRollLeft', axis: new THREE.Vector3(0, 0, 1), angle: Math.PI / 2 },
    { id: 'btnRollRight', axis: new THREE.Vector3(0, 0, 1), angle: -Math.PI / 2 },
    { id: 'btnTiltFwd', axis: new THREE.Vector3(1, 0, 0), angle: -Math.PI / 2 },
    { id: 'btnTiltBack', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI / 2 },
    { id: 'btnFlip', axis: new THREE.Vector3(1, 0, 0), angle: Math.PI }
  ];

  rotateButtons.forEach(btnInfo => {
    document.getElementById(btnInfo.id).addEventListener('click', () => handleRotationClick(btnInfo));
  });
}

/**
 * ゲームを開始するメイン関数
 */
function startGame() {
  const selectedMode = document.getElementById('gameModeSelector').value;
  currentGameConfig = gameModes[selectedMode];

  player2IsCPU = document.getElementById('opponentSelector').value === 'cpu';
  if (player2IsCPU) {
    cpuDifficulty = document.getElementById('cpuDifficultySelector').value;
    cpu.init(cpuDifficulty);
  }

  GRID = currentGameConfig.gridSize;

  document.getElementById('menuContainer').style.display = 'none';
  document.getElementById('ui').style.display = 'block';

  if (gameGroup) {
    scene.remove(gameGroup);
    gameGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
        else child.material.dispose();
      }
    });
  }

  gameGroup = new THREE.Group();
  scene.add(gameGroup);

  initBoard();

  drawGrid3D();
  createInitialGhostPoles();

  const groundGeo = new THREE.PlaneGeometry(GRID, GRID);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const groundPlane = new THREE.Mesh(groundGeo, groundMat);
  groundPlane.rotateX(-Math.PI / 2);
  groundPlane.position.y = -GRID / 2 - 0.01;
  groundPlane.receiveShadow = true;
  gameGroup.add(groundPlane);

  highlightPlane.geometry.dispose();
  highlightPlane.geometry = new THREE.PlaneGeometry(GRID, GRID);
  gameGroup.add(highlightPlane);

  columnHighlightMesh.geometry.dispose();
  columnHighlightMesh.geometry = new THREE.BoxGeometry(0.9, GRID - 0.05, 0.9);
  gameGroup.add(columnHighlightMesh);

  gameGroup.add(previewSphere);

  camera.position.set(0, GRID * 1.5, GRID * 3);
  controls.target.set(0, 0, 0);
  homeCameraPosition.copy(camera.position);
  homeControlsTarget.copy(controls.target);

  gameGroup.quaternion.set(0, 0, 0, 1);
  gravity.set(0, -1, 0);

  enableButtons();
}

/**
 * 現在のゲームをリセットする
 */
function resetGame() {
  if (!currentGameConfig) {
    alert("No game is currently running to reset.");
    return;
  }
  showConfirmDialog("Are you sure you want to reset the current game? All progress will be lost.", startGame);
}

/**
 * メニュー画面を表示する関数
 */
function showMenu() {
  document.getElementById('menuContainer').style.display = 'flex';
  document.getElementById('ui').style.display = 'none';
  currentGameConfig = null;
  player2IsCPU = false;

  if (gameGroup) {
    scene.remove(gameGroup);
    gameGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
        else child.material.dispose();
      }
    });
    gameGroup = null;
  }
  isGameOver = false;
  history = [];
}

/**
 * ゲーム盤のデータ関連を初期化する関数
 */
function initBoard() {
  board = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(0)));
  ghostPoles = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(null)));
  currentPlayer = 1;
  gravity.set(0, -1, 0);
  selectedCellForPlacement = null;
  selectedRotation = null;
  shiftCounts = { 1: currentGameConfig.initialShifts, 2: currentGameConfig.initialShifts };
  shiftCooldowns = { 1: 0, 2: 0 };
  history = [];
  isGameOver = false;
  clearHighlightSpheres();
  hideHighlight();
  updateStatus();
}

/**
 * クリック時の処理 (駒の配置 or 回転選択のキャンセル)
 */
function onClick(event) {
  if (uiControlsDisabled || isGameOver || (player2IsCPU && currentPlayer === 2)) return;

  if (selectedRotation) {
    selectedRotation = null;
    hideHighlight();
    updateStatus();
    return;
  }

  const point = getIntersectPoint(event);
  let clickedLandingCell = null;
  if (point) {
    const { axis: gravityAxis, dir: gravityDir } = getGravityAxisAndDir();
    let cX, cY, cZ;
    if (gravityAxis === 'y') { cX = Math.floor(point.x + GRID / 2); cZ = Math.floor(point.z + GRID / 2); }
    else if (gravityAxis === 'x') { cY = Math.floor(point.y + GRID / 2); cZ = Math.floor(point.z + GRID / 2); }
    else { cX = Math.floor(point.x + GRID / 2); cY = Math.floor(point.y + GRID / 2); }
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
    if (clickedLandingCell && clickedLandingCell.boardX === selectedCellForPlacement.boardX && clickedLandingCell.boardY === selectedCellForPlacement.boardY && clickedLandingCell.boardZ === selectedCellForPlacement.boardZ) {
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
 * 内部的な駒配置処理
 */
function placePieceInternal(px, py, pz) {
  saveState();
  board[py][pz][px] = currentPlayer;
  animateDrop(px, py, pz, currentPlayer);
  selectedCellForPlacement = null;
  hidePreviews();

  if (checkWin()) return;

  endTurn();
}

/**
 * 回転ボタンのクリックを処理する
 */
function handleRotationClick(btnInfo) {
  if (uiControlsDisabled || isGameOver || (player2IsCPU && currentPlayer === 2)) return;

  if (shiftCounts[currentPlayer] <= 0) {
    alert("You have no gravity shifts left!");
    return;
  }
  if (shiftCooldowns[currentPlayer] > 0) {
    alert(`You must wait ${shiftCooldowns[currentPlayer]} more turn(s) to shift gravity again.`);
    return;
  }

  if (selectedRotation && selectedRotation.id === btnInfo.id) {
    executeRotation(btnInfo.axis, btnInfo.angle);
    selectedRotation = null;
    hideHighlight();
  } else {
    selectedCellForPlacement = null;
    hidePreviews();

    selectedRotation = btnInfo;
    showHighlight(btnInfo.axis, btnInfo.angle);
    updateStatus();
  }
}

/**
 * 立方体を回転させるメイン関数
 */
function executeRotation(rotationAxis, angle) {
  if (isGameOver || !gameGroup) return;

  saveState();
  shiftCounts[currentPlayer]--;
  shiftCooldowns[currentPlayer] = currentGameConfig.shiftCooldown;
  // (setUiControlsDisabled より前、gravity.copy の前が効果的です)

  const originalGroupQuaternion = gameGroup.quaternion.clone();
  const mainRotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
  const targetGroupQuaternion = mainRotationQuaternion.clone().multiply(originalGroupQuaternion);
  const worldDown = new THREE.Vector3(0, -1, 0);
  let newLocalGravity = worldDown.clone().applyQuaternion(targetGroupQuaternion.clone().invert());
  let absX = Math.abs(newLocalGravity.x);
  let absY = Math.abs(newLocalGravity.y);
  let absZ = Math.abs(newLocalGravity.z);
  let maxVal = Math.max(absX, absY, absZ);
  if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0);
  else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0);
  else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z));

  console.log("[ExecuteRotation] Calculated newLocalGravity:", newLocalGravity.x.toFixed(2), newLocalGravity.y.toFixed(2), newLocalGravity.z.toFixed(2)); // ★ 追加したログ
  gravity.copy(newLocalGravity);

  setUiControlsDisabled(true); // この行は gravity.copy の後でも問題ありません

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
      if (currentGameConfig.shiftEndsTurn) {
        endTurn();
      } else {
        setUiControlsDisabled(false);
        updateStatus();
      }
    });
}


/**
 * プレイヤーを交代し、必要ならCPUのターンを開始する
 */
function endTurn() {
  switchPlayer();
  if (player2IsCPU && currentPlayer === 2 && !isGameOver) {
    cpu.makeMove();
  } else {
    // Re-enable controls for human player
    setUiControlsDisabled(false);
  }
}

/**
 * プレイヤーを交代する内部関数
 */
function switchPlayer() {
  currentPlayer = 3 - currentPlayer;
  if (shiftCooldowns[currentPlayer] > 0) {
    shiftCooldowns[currentPlayer]--;
  }
  updateStatus();
}

/**
 * UIの操作可否を設定する
 * @param {boolean} disabled - 操作不可にするか
 * @param {boolean} isCpuTurn - CPUのターンか
 */
function setUiControlsDisabled(disabled, isCpuTurn = false) {
  uiControlsDisabled = disabled;
  if (isGameOver) return;

  // Rotation buttons are disabled if it's not a human's turn or UI is generally disabled
  const canShift = shiftCounts[currentPlayer] > 0 && shiftCooldowns[currentPlayer] === 0;
  const rotateButtons = document.querySelectorAll('#btnRollLeft, #btnRollRight, #btnTiltFwd, #btnTiltBack, #btnFlip');
  rotateButtons.forEach(btn => btn.disabled = disabled || !canShift || (player2IsCPU && currentPlayer === 2));
}


function updateStatus() {
  if (isGameOver) {
    const statusElem = document.getElementById('status');
    if (statusElem && (statusElem.innerHTML.includes("wins") || statusElem.innerHTML.includes("Draw"))) { return; }
  }
  if (!currentGameConfig) return;

  const playerColor = currentPlayer === 1 ? 'Red' : 'Blue';
  const playerHexColor = currentPlayer === 1 ? colors[1].toString(16).padStart(6, '0') : colors[2].toString(16).padStart(6, '0');
  let statusText = `Player: <strong style="color: #${playerHexColor}">${playerColor} ${player2IsCPU && currentPlayer === 2 ? "(CPU)" : ""}</strong>`;

  if (currentGameConfig.initialShifts > 0) {
    statusText += ` &nbsp; | &nbsp; Shifts Left: ${shiftCounts[currentPlayer]}`;
    if (shiftCooldowns[currentPlayer] > 0) {
      statusText += ` &nbsp; | &nbsp; <span style="color: #ffcc00;">Shift Cooldown: ${shiftCooldowns[currentPlayer]} turn(s)</span>`;
    }
  }

  if (player2IsCPU && currentPlayer === 2 && cpu.isThinking) {
    statusText += " <br>CPU is thinking...";
  } else if (selectedRotation) {
    statusText += " <br> Click the rotation button again to confirm, or click the board to cancel.";
  } else if (selectedCellForPlacement) {
    statusText += " <br> Click again on highlighted column to place piece.";
  }

  document.getElementById('status').innerHTML = statusText;
}

// game.js の showHighlight 関数を以下に置き換えてください。
function showHighlight(rotationAxis, angle) {
  if (uiControlsDisabled || !gameGroup) return; // ガード処理は先頭に
  const currentQuaternion = gameGroup.quaternion.clone();
  const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
  const targetQuaternion = rotationQuaternion.multiply(currentQuaternion); const worldDown = new THREE.Vector3(0, -1, 0);
  let newLocalGravity = worldDown.clone().applyQuaternion(targetQuaternion.clone().invert());

  let absX = Math.abs(newLocalGravity.x);
  let absY = Math.abs(newLocalGravity.y);
  let absZ = Math.abs(newLocalGravity.z);
  let maxVal = Math.max(absX, absY, absZ);
  if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0);
  else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0);
  else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z));

  // PlaneGeometryのデフォルトの法線は (0,0,1) (ローカルZ+方向)
  const defaultPlaneNormal = new THREE.Vector3(0, 0, 1);
  // ハイライトプレーンの法線は、新しい重力方向を向くようにする
  // (つまり、ハイライトされる面は「天井」側で、その面は「床」の方向を向いている)
  let targetPlaneNormal = new THREE.Vector3().copy(newLocalGravity);

  const halfGrid = GRID / 2 + 0.01;

  // ハイライトプレーンの位置は、新しい重力方向の「天井」側 (newLocalGravity と逆方向の面)
  if (newLocalGravity.x === 1) { // 新しい「下」がローカル+X。ハイライトはローカル+X面 (天井)。
    highlightPlane.position.set(halfGrid, 0, 0);
  } else if (newLocalGravity.x === -1) { // 新しい「下」がローカル-X。ハイライトはローカル-X面 (天井)。
    highlightPlane.position.set(-halfGrid, 0, 0);
  } else if (newLocalGravity.y === 1) { // 新しい「下」がローカル+Y。ハイライトはローカル+Y面 (天井)。
    highlightPlane.position.set(0, halfGrid, 0);
  } else if (newLocalGravity.y === -1) { // 新しい「下」がローカル-Y。ハイライトはローカル-Y面 (天井)。
    highlightPlane.position.set(0, -halfGrid, 0);
  } else if (newLocalGravity.z === 1) { // 新しい「下」がローカル+Z。ハイライトはローカル+Z面 (天井)。
    highlightPlane.position.set(0, 0, halfGrid);
  } else if (newLocalGravity.z === -1) { // 新しい「下」がローカル-Z。ハイライトはローカル-Z面 (天井)。
    highlightPlane.position.set(0, 0, -halfGrid);
  }

  highlightPlane.quaternion.setFromUnitVectors(defaultPlaneNormal, targetPlaneNormal);
  highlightPlane.visible = true;
}
//function showHighlight(rotationAxis, angle) { if (uiControlsDisabled || !gameGroup) return; const currentQuaternion = gameGroup.quaternion.clone(); const rotationQuaternion = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle); const targetQuaternion = currentQuaternion.multiply(rotationQuaternion); const worldDown = new THREE.Vector3(0, -1, 0); let newLocalGravity = worldDown.clone().applyQuaternion(targetQuaternion.clone().invert()); let absX = Math.abs(newLocalGravity.x); let absY = Math.abs(newLocalGravity.y); let absZ = Math.abs(newLocalGravity.z); let maxVal = Math.max(absX, absY, absZ); if (maxVal === absX) newLocalGravity.set(Math.sign(newLocalGravity.x), 0, 0); else if (maxVal === absY) newLocalGravity.set(0, Math.sign(newLocalGravity.y), 0); else newLocalGravity.set(0, 0, Math.sign(newLocalGravity.z)); highlightPlane.rotation.set(0, 0, 0); const halfGrid = GRID / 2 + 0.01; if (newLocalGravity.x === 1) { highlightPlane.position.set(halfGrid, 0, 0); highlightPlane.rotation.y = -Math.PI / 2; } else if (newLocalGravity.x === -1) { highlightPlane.position.set(-halfGrid, 0, 0); highlightPlane.rotation.y = Math.PI / 2; } else if (newLocalGravity.y === 1) { highlightPlane.position.set(0, halfGrid, 0); highlightPlane.rotation.x = Math.PI / 2; } else if (newLocalGravity.y === -1) { highlightPlane.position.set(0, -halfGrid, 0); highlightPlane.rotation.x = -Math.PI / 2; } else if (newLocalGravity.z === 1) { highlightPlane.position.set(0, 0, halfGrid); highlightPlane.rotation.y = 0; } else if (newLocalGravity.z === -1) { highlightPlane.position.set(0, 0, -halfGrid); highlightPlane.rotation.y = Math.PI; } highlightPlane.visible = true; }
function hideHighlight() { if (highlightPlane) highlightPlane.visible = false; }
function createInitialGhostPoles() { if (!gameGroup) return; const ghostPoleMat = new THREE.MeshStandardMaterial({ color: 0x999999, transparent: true, opacity: GHOST_POLE_OPACITY, metalness: 0.0, roughness: 0.9 }); for (let y = 0; y < GRID; y++) { for (let z = 0; z < GRID; z++) { for (let x = 0; x < GRID; x++) { const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, 1, 6); const ghostPole = new THREE.Mesh(poleGeo, ghostPoleMat.clone()); ghostPole.userData.isGhostPole = true; ghostPole.userData.boardX = x; ghostPole.userData.boardY = y; ghostPole.userData.boardZ = z; updateSingleGhostPole(ghostPole, x, y, z, gravity); ghostPole.visible = (board[y][z][x] === 0); gameGroup.add(ghostPole); ghostPoles[y][z][x] = ghostPole; } } } }
function updateSingleGhostPole(ghostPole, boardX, boardY, boardZ, currentGravityVec) { const cellCenter = get3DPosition(boardX, boardY, boardZ); const validPoleLength = Math.max(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR * 2, 1.0); ghostPole.geometry.dispose(); ghostPole.geometry = new THREE.CylinderGeometry(POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, POLE_RADIUS * GHOST_POLE_RADIUS_FACTOR, validPoleLength, 6); ghostPole.position.copy(cellCenter); ghostPole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), currentGravityVec.clone().negate()); }
function updateAllGhostPolesVisibilityAndTransform() { for (let y = 0; y < GRID; y++) { for (let z = 0; z < GRID; z++) { for (let x = 0; x < GRID; x++) { const ghostPole = ghostPoles[y]?.[z]?.[x]; if (ghostPole) { if (board[y][z][x] === 0) { updateSingleGhostPole(ghostPole, x, y, z, gravity); ghostPole.visible = true; } else { ghostPole.visible = false; } } } } } }
function drawGrid3D() { if (!gameGroup) return; const halfGrid = GRID / 2.0; const outerBoxGeo = new THREE.BoxGeometry(GRID, GRID, GRID); const outerEdges = new THREE.EdgesGeometry(outerBoxGeo); const outerLines = new THREE.LineSegments(outerEdges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })); gameGroup.add(outerLines); const innerLinesMaterial = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.3 }); const linesPoints = []; for (let i = 1; i < GRID; i++) { const coord = -halfGrid + i; linesPoints.push(new THREE.Vector3(-halfGrid, coord, -halfGrid), new THREE.Vector3(halfGrid, coord, -halfGrid)); linesPoints.push(new THREE.Vector3(-halfGrid, coord, halfGrid), new THREE.Vector3(halfGrid, coord, halfGrid)); linesPoints.push(new THREE.Vector3(-halfGrid, -halfGrid, coord), new THREE.Vector3(halfGrid, -halfGrid, coord)); linesPoints.push(new THREE.Vector3(-halfGrid, halfGrid, coord), new THREE.Vector3(halfGrid, halfGrid, coord)); linesPoints.push(new THREE.Vector3(coord, -halfGrid, -halfGrid), new THREE.Vector3(coord, halfGrid, -halfGrid)); linesPoints.push(new THREE.Vector3(coord, -halfGrid, halfGrid), new THREE.Vector3(coord, halfGrid, halfGrid)); linesPoints.push(new THREE.Vector3(coord, -halfGrid, -halfGrid), new THREE.Vector3(coord, -halfGrid, halfGrid)); linesPoints.push(new THREE.Vector3(coord, halfGrid, -halfGrid), new THREE.Vector3(coord, halfGrid, halfGrid)); linesPoints.push(new THREE.Vector3(-halfGrid, coord, -halfGrid), new THREE.Vector3(-halfGrid, coord, halfGrid)); linesPoints.push(new THREE.Vector3(halfGrid, coord, -halfGrid), new THREE.Vector3(halfGrid, coord, halfGrid)); } if (linesPoints.length > 0) { const innerGeometry = new THREE.BufferGeometry().setFromPoints(linesPoints); const innerLineSegments = new THREE.LineSegments(innerGeometry, innerLinesMaterial); gameGroup.add(innerLineSegments); } }
function get3DPosition(x, y, z) { return new THREE.Vector3(x - GRID / 2 + 0.5, y - GRID / 2 + 0.5, z - GRID / 2 + 0.5); }
function animateDrop(x, y, z, player) { if (!gameGroup) return; const targetPos = get3DPosition(x, y, z); const startPos = targetPos.clone().sub(gravity.clone().multiplyScalar(GRID)); const sphereGeo = new THREE.SphereGeometry(0.4, 32, 16); const sphereMat = new THREE.MeshStandardMaterial({ color: colors[player], metalness: 0.3, roughness: 0.4 }); const sphere = new THREE.Mesh(sphereGeo, sphereMat); sphere.position.copy(startPos); sphere.castShadow = true; sphere.userData.isPiece = true; sphere.userData.boardX = x; sphere.userData.boardY = y; sphere.userData.boardZ = z; gameGroup.add(sphere); const pole = createSupportPole(sphere); sphere.userData.pole = pole; gameGroup.add(pole); if (ghostPoles[y]?.[z]?.[x]) { ghostPoles[y][z][x].visible = false; } animateMotion(sphere, targetPos, () => { updateSupportPole(sphere, pole); pole.visible = true; }); }
function createSupportPole(pieceMesh) { const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, 0.01, 8); const poleMat = new THREE.MeshStandardMaterial({ color: 0x999999, transparent: true, opacity: GHOST_POLE_OPACITY, metalness: 0.0, roughness: 0.9 }); const pole = new THREE.Mesh(poleGeo, poleMat); pole.castShadow = true; pole.userData.isPole = true; pole.visible = false; return pole; }
function updateSupportPole(pieceMesh, poleMesh) { const piecePos = pieceMesh.position; const cellCenter = get3DPosition(pieceMesh.userData.boardX, pieceMesh.userData.boardY, pieceMesh.userData.boardZ); const { axis, dir } = getGravityAxisAndDir(); const cellBottomPlaneCoord = cellCenter[axis] - 0.5 * dir; let poleLength = Math.max(POLE_RADIUS * 2, Math.abs(piecePos[axis] - cellBottomPlaneCoord)); poleMesh.geometry.dispose(); poleMesh.geometry = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, poleLength, 8); const poleCenterOnAxis = (piecePos[axis] + cellBottomPlaneCoord) / 2; const poleCenterPos = piecePos.clone(); poleCenterPos[axis] = poleCenterOnAxis; poleMesh.position.copy(poleCenterPos); poleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate()); }
function getIntersectPoint(event) { if (uiControlsDisabled || !gameGroup) return null; const rect = renderer.domElement.getBoundingClientRect(); const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(mouse, camera); const invMatrix = new THREE.Matrix4().copy(gameGroup.matrixWorld).invert(); const localRay = new THREE.Ray().copy(raycaster.ray).applyMatrix4(invMatrix); const boundingBox = new THREE.Box3(new THREE.Vector3(-GRID / 2, -GRID / 2, -GRID / 2), new THREE.Vector3(GRID / 2, GRID / 2, GRID / 2)); return localRay.intersectBox(boundingBox, new THREE.Vector3()); }
function updatePreviewsForSelection() { if (selectedCellForPlacement) { const { boardX, boardY, boardZ } = selectedCellForPlacement; previewSphere.position.copy(get3DPosition(boardX, boardY, boardZ)); previewSphere.material.color.set(colors[currentPlayer]); previewSphere.visible = true; const { axis: gravityAxis } = getGravityAxisAndDir(); const columnCenter = new THREE.Vector3(); if (gravityAxis === 'y') { columnCenter.set(get3DPosition(boardX, 0, boardZ).x, 0, get3DPosition(boardX, 0, boardZ).z); } else if (gravityAxis === 'x') { columnCenter.set(0, get3DPosition(0, boardY, boardZ).y, get3DPosition(0, boardY, boardZ).z); } else { columnCenter.set(get3DPosition(boardX, boardY, 0).x, get3DPosition(boardX, boardY, 0).y, 0); } columnHighlightMesh.position.copy(columnCenter); columnHighlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate()); columnHighlightMesh.visible = true; } }
function hidePreviews() { if (previewSphere) previewSphere.visible = false; if (columnHighlightMesh) columnHighlightMesh.visible = false; }
function onMouseMove(event) { console.log("[Debug] onMouseMove - Current Gravity:", gravity.x.toFixed(2), gravity.y.toFixed(2), gravity.z.toFixed(2)); if (selectedCellForPlacement || uiControlsDisabled || isGameOver || selectedRotation || (player2IsCPU && currentPlayer === 2)) { hidePreviews(); return; } const point = getIntersectPoint(event); if (point) { const { axis: gravityAxis, dir: gravityDir } = getGravityAxisAndDir(); let cX, cY, cZ; if (gravityAxis === 'y') { cX = Math.floor(point.x + GRID / 2); cZ = Math.floor(point.z + GRID / 2); } else if (gravityAxis === 'x') { cY = Math.floor(point.y + GRID / 2); cZ = Math.floor(point.z + GRID / 2); } else { cX = Math.floor(point.x + GRID / 2); cY = Math.floor(point.y + GRID / 2); } let landingCellFound = false; for (let i = 0; i < GRID; i++) { const w = (gravityDir === -1) ? i : GRID - 1 - i; const checkPos = {}; if (gravityAxis === 'y') { checkPos.x = cX; checkPos.y = w; checkPos.z = cZ; } else if (gravityAxis === 'x') { checkPos.x = w; checkPos.y = cY; checkPos.z = cZ; } else { checkPos.x = cX; checkPos.y = cY; checkPos.z = w; } if (checkPos.x >= 0 && checkPos.x < GRID && checkPos.y >= 0 && checkPos.y < GRID && checkPos.z >= 0 && checkPos.z < GRID) { if (board[checkPos.y][checkPos.z][checkPos.x] === 0) { previewSphere.position.copy(get3DPosition(checkPos.x, checkPos.y, checkPos.z)); previewSphere.material.color.set(colors[currentPlayer]); previewSphere.visible = true; landingCellFound = true; const columnCenter = new THREE.Vector3(); if (gravityAxis === 'y') { columnCenter.set(get3DPosition(checkPos.x, 0, checkPos.z).x, 0, get3DPosition(checkPos.x, 0, checkPos.z).z); } else if (gravityAxis === 'x') { columnCenter.set(0, get3DPosition(0, checkPos.y, checkPos.z).y, get3DPosition(0, checkPos.y, checkPos.z).z); } else { columnCenter.set(get3DPosition(checkPos.x, checkPos.y, 0).x, get3DPosition(checkPos.x, checkPos.y, 0).y, 0); } columnHighlightMesh.position.copy(columnCenter); columnHighlightMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gravity.clone().negate()); columnHighlightMesh.visible = true; } } } if (!landingCellFound) { hidePreviews(); } } else { hidePreviews(); } }
function animateRotationHint(axis, mainRotationAngle, initialQuaternion) { return new Promise(resolve => { const hintAngle = Math.sign(mainRotationAngle) * Math.PI / 18; const hintSpeed = 0.25; const qHintTarget = initialQuaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, hintAngle)); const qInitial = initialQuaternion.clone(); let phase = 0; const loopHint = () => { let currentTargetQuaternion = (phase === 0) ? qHintTarget : qInitial; if (gameGroup.quaternion.angleTo(currentTargetQuaternion) > 0.01) { gameGroup.quaternion.slerp(currentTargetQuaternion, hintSpeed); requestAnimationFrame(loopHint); } else { gameGroup.quaternion.copy(currentTargetQuaternion); if (phase === 0) { phase = 1; requestAnimationFrame(loopHint); } else { resolve(); } } }; loopHint(); }); }
function animateRotation(targetQuaternion) { return new Promise(resolve => { const mainRotationSpeed = 0.15; const loop = () => { if (gameGroup.quaternion.angleTo(targetQuaternion) > 0.01) { gameGroup.quaternion.slerp(targetQuaternion, mainRotationSpeed); requestAnimationFrame(loop); } else { gameGroup.quaternion.copy(targetQuaternion); resolve(); } }; loop(); }); }
async function animateBoardUpdate() { if (!gameGroup) return; applyGravity(); const currentPieces = gameGroup.children.filter(obj => obj.userData.isPiece); const targetPieceData = []; for (let y = 0; y < GRID; y++) { for (let z = 0; z < GRID; z++) { for (let x = 0; x < GRID; x++) { if (board[y][z][x] !== 0) { targetPieceData.push({ pos: get3DPosition(x, y, z), player: board[y][z][x], boardX: x, boardY: y, boardZ: z }); } } } } const animationPromises = []; const unassignedPieces = [...currentPieces]; for (const target of targetPieceData) { let pieceToMove = null; let poleToMove = null; let pieceIndex = -1; const { axis: gravityAxis } = getGravityAxisAndDir(); for (let i = 0; i < unassignedPieces.length; i++) { const piece = unassignedPieces[i]; let match = piece.material.color.getHex() === colors[target.player]; if (gravityAxis === 'y') match = match && piece.userData.boardX === target.boardX && piece.userData.boardZ === target.boardZ; else if (gravityAxis === 'x') match = match && piece.userData.boardY === target.boardY && piece.userData.boardZ === target.boardZ; else match = match && piece.userData.boardX === target.boardX && piece.userData.boardY === target.boardY; if (match) { pieceToMove = piece; poleToMove = piece.userData.pole; pieceIndex = i; break; } } if (!pieceToMove) { for (let i = 0; i < unassignedPieces.length; i++) { const piece = unassignedPieces[i]; if (piece.material.color.getHex() === colors[target.player]) { pieceToMove = piece; poleToMove = piece.userData.pole; pieceIndex = i; break; } } } if (pieceToMove && poleToMove) { animationPromises.push(new Promise(resolve => { animateMotion(pieceToMove, target.pos, () => { updateSupportPole(pieceToMove, poleToMove); poleToMove.visible = true; resolve(); }); })); pieceToMove.userData.boardX = target.boardX; pieceToMove.userData.boardY = target.boardY; pieceToMove.userData.boardZ = target.boardZ; unassignedPieces.splice(pieceIndex, 1); } } unassignedPieces.forEach(piece => { if (piece.userData.pole) gameGroup.remove(piece.userData.pole); gameGroup.remove(piece); }); await Promise.all(animationPromises); updateAllGhostPolesVisibilityAndTransform(); }
function animateMotion(mesh, targetPosition, onComplete) { const loop = () => { if (mesh.position.distanceTo(targetPosition) > 0.01) { mesh.position.lerp(targetPosition, 0.15); if (mesh.userData.isPiece && mesh.userData.pole) { updateSupportPole(mesh, mesh.userData.pole); } requestAnimationFrame(loop); } else { mesh.position.copy(targetPosition); if (onComplete) onComplete(); } }; loop(); }
function applyGravity() { board = applyGravityToBoard(board, gravity); }

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

  let isDraw = true;

  for (let y = 0; y < GRID; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const player = board[y][z][x];

        if (player === 0) {
          isDraw = false;
          continue;
        }

        for (const [dx, dy, dz] of directions) {
          let positions = [];
          let valid = true;
          for (let i = 0; i < currentGameConfig.winLength; i++) {
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

  const statusElem = document.getElementById("status");

  if (count1 > 0 || count2 > 0) {
    let message = "";
    let winnerHexColor = "#FFFF00";
    if (count1 > count2) {
      message = `Red wins with ${count1} line(s)!`;
      winnerHexColor = "#" + colors[1].toString(16).padStart(6, '0');
    } else if (count2 > count1) {
      message = `Blue wins with ${count2} line(s)! ${player2IsCPU ? "(CPU)" : ""}`;
      winnerHexColor = "#" + colors[2].toString(16).padStart(6, '0');
    } else {
      message = `Draw! Both players have ${count1} line(s).`;
    }
    alert(message);
    if (statusElem) {
      statusElem.innerHTML = `<strong style="color: ${winnerHexColor};">${message}</strong>`;
    }
    isGameOver = true;
    disableButtons();
    return true;
  }

  if (isDraw) {
    const message = "It's a draw! The cube is full.";
    alert(message);
    if (statusElem) {
      statusElem.innerHTML = `<strong style="color: #FFFF00;">${message}</strong>`;
    }
    isGameOver = true;
    disableButtons();
    return true;
  }

  return false;
}

function highlightLines(lines) { if (!gameGroup) return; lines.forEach(positions => { positions.forEach(({ x, y, z }) => { const foundPiece = gameGroup.children.find(obj => obj.userData.isPiece && obj.userData.boardX === x && obj.userData.boardY === y && obj.userData.boardZ === z); if (foundPiece && foundPiece.material) { foundPiece.material.emissive.copy(foundPiece.material.color); foundPiece.material.emissiveIntensity = 1.0; highlightSpheres.push(foundPiece); } }); }); }
function disableButtons() { const buttons = document.querySelectorAll('#ui button'); buttons.forEach(btn => { const enabledIds = ['backToMenuButton', 'resetGameButton', 'resetViewButton', 'instructionsButton', 'undoButton']; if (!enabledIds.includes(btn.id)) { btn.disabled = true; } }); setUiControlsDisabled(true); }
function enableButtons() { const buttons = document.querySelectorAll('#ui button'); buttons.forEach(btn => { btn.disabled = false; }); setUiControlsDisabled(false); updateStatus(); }
function clearHighlightSpheres() { highlightSpheres.forEach(sphere => { if (sphere.material) { sphere.material.emissive.set(0x000000); sphere.material.emissiveIntensity = 0; } }); highlightSpheres = []; }
function getGravityAxisAndDir() { return getGravityAxisAndDirFromVec(gravity); }
function getGravityAxisAndDirFromVec(gravityVector) { let axis = 'y'; if (Math.abs(gravityVector.x) > Math.abs(gravityVector.y) && Math.abs(gravityVector.x) > Math.abs(gravityVector.z)) axis = 'x'; else if (Math.abs(gravityVector.z) > Math.abs(gravityVector.y)) axis = 'z'; const dir = Math.sign(gravityVector[axis]); return { axis, dir }; }
function onWindowResize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }
function resetView() { isReturningToHomeView = true; }
function toggleInstructions(show) { const modal = document.getElementById('instructionsModal'); if (modal) { modal.style.display = show ? 'flex' : 'none'; setUiControlsDisabled(show, false); updateStatus(); } }
function showConfirmDialog(message, onYesCallback) { const modal = document.getElementById('confirmModal'); const msgElement = document.getElementById('confirmMessage'); const yesBtn = document.getElementById('confirmYes'); const noBtn = document.getElementById('confirmNo'); msgElement.textContent = message; const newYesBtn = yesBtn.cloneNode(true); yesBtn.parentNode.replaceChild(newYesBtn, yesBtn); const newNoBtn = noBtn.cloneNode(true); noBtn.parentNode.replaceChild(newNoBtn, noBtn); newYesBtn.addEventListener('click', () => { modal.style.display = 'none'; setUiControlsDisabled(false); onYesCallback(); }); newNoBtn.addEventListener('click', () => { modal.style.display = 'none'; setUiControlsDisabled(false); updateStatus(); }); modal.style.display = 'flex'; setUiControlsDisabled(true); }
function animate() { requestAnimationFrame(animate); if (isReturningToHomeView) { camera.position.lerp(homeCameraPosition, 0.1); controls.target.lerp(homeControlsTarget, 0.1); if (camera.position.distanceTo(homeCameraPosition) < 0.01 && controls.target.distanceTo(homeControlsTarget) < 0.01) { camera.position.copy(homeCameraPosition); controls.target.copy(homeControlsTarget); isReturningToHomeView = false; } } controls.update(); renderer.render(scene, camera); }

function saveState() {
  if (!currentGameConfig) return;
  const state = {
    board: JSON.parse(JSON.stringify(board)),
    currentPlayer: currentPlayer,
    gravity: gravity.clone(),
    quaternion: gameGroup ? gameGroup.quaternion.clone() : new THREE.Quaternion(),
    shiftCounts: { ...shiftCounts },
    shiftCooldowns: { ...shiftCooldowns },
  };
  history.push(state);
}

function undoMove() {
  if (history.length === 0) {
    alert("There are no moves to undo.");
    return;
  }
  showConfirmDialog("Are you sure you want to undo the last move?", performUndo);
}

function performUndo() {
  if (history.length === 0) return;

  // １回目のポップ（最後に保存された状態を取り出す）
  let lastState = history.pop();

  isGameOver = false;
  clearHighlightSpheres();

  board = lastState.board;
  currentPlayer = lastState.currentPlayer;
  gravity.copy(lastState.gravity);
  if (gameGroup) gameGroup.quaternion.copy(lastState.quaternion);
  shiftCounts = lastState.shiftCounts;
  shiftCooldowns = lastState.shiftCooldowns;

  // ───────── CPU対戦中かつ currentPlayer が 2（CPUの番）なら、
  //    さらにもう一度 pop して「人間のターン直後」の状態に戻す
  if (player2IsCPU && currentPlayer === 2 && history.length > 0) {
    lastState = history.pop();

    board = lastState.board;
    currentPlayer = lastState.currentPlayer;
    gravity.copy(lastState.gravity);
    if (gameGroup) gameGroup.quaternion.copy(lastState.quaternion);
    shiftCounts = lastState.shiftCounts;
    shiftCooldowns = lastState.shiftCooldowns;
  }

  // ───────── 以下、盤面オブジェクトを再構築する既存の処理 ─────────
  if (gameGroup) {
    // 既存の駒とポールをすべて削除
    for (let i = gameGroup.children.length - 1; i >= 0; i--) {
      const obj = gameGroup.children[i];
      if (obj.userData.isPiece || obj.userData.isPole) {
        gameGroup.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      }
    }
    // board 配列に従って駒とポールを再生成
    for (let y = 0; y < GRID; y++) {
      for (let z = 0; z < GRID; z++) {
        for (let x = 0; x < GRID; x++) {
          const player = board[y][z][x];
          if (player !== 0) {
            const pos = get3DPosition(x, y, z);
            const sphereGeo = new THREE.SphereGeometry(0.4, 32, 16);
            const sphereMat = new THREE.MeshStandardMaterial({
              color: colors[player],
              metalness: 0.3,
              roughness: 0.4
            });
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            sphere.position.copy(pos);
            sphere.castShadow = true;
            sphere.receiveShadow = false;
            sphere.userData.isPiece = true;
            sphere.userData.boardX = x;
            sphere.userData.boardY = y;
            sphere.userData.boardZ = z;
            gameGroup.add(sphere);

            const pole = createSupportPole(sphere);
            sphere.userData.pole = pole;
            updateSupportPole(sphere, pole);
            pole.visible = true;
            gameGroup.add(pole);
          }
        }
      }
    }
  }

  updateAllGhostPolesVisibilityAndTransform();
  selectedCellForPlacement = null;
  selectedRotation = null;
  hidePreviews();
  hideHighlight();

  enableButtons();
  updateStatus();
}


// ★ ADDED: Functions for CPU to interact with the game state safely ★

function applyGravityToBoard(currentBoard, gravityVector) {
  const { axis, dir } = getGravityAxisAndDirFromVec(gravityVector);
  const newBoard = Array(GRID).fill(null).map(() => Array(GRID).fill(null).map(() => Array(GRID).fill(0)));
  const u_axis = axis === 'x' ? 'y' : 'x';
  const v_axis = axis === 'z' ? (axis === 'x' ? 'z' : 'y') : 'z';
  for (let u = 0; u < GRID; u++) {
    for (let v = 0; v < GRID; v++) {
      const line = [];
      for (let w_scan = 0; w_scan < GRID; w_scan++) {
        const pos = {}; pos[u_axis] = u; pos[v_axis] = v; pos[axis] = w_scan;
        if (currentBoard[pos.y][pos.z][pos.x] !== 0) {
          if (dir === -1) { line.push(currentBoard[pos.y][pos.z][pos.x]); }
          else { line.unshift(currentBoard[pos.y][pos.z][pos.x]); }
        }
      }
      for (let i = 0; i < line.length; i++) {
        const w_fill = (dir === -1) ? i : GRID - 1 - i;
        const pos_fill = {}; pos_fill[u_axis] = u; pos_fill[v_axis] = v; pos_fill[axis] = w_fill;
        newBoard[pos_fill.y][pos_fill.z][pos_fill.x] = line[i];
      }
    }
  }
  return newBoard;
}

// game.js の末尾

// Getters for cpu.js
function getBoardState() { return JSON.parse(JSON.stringify(board)); }
function getWinLength() { return currentGameConfig.winLength; }
function getGravityVector() { return gravity.clone(); }
function getGameGroupQuaternion() { return gameGroup ? gameGroup.quaternion.clone() : new THREE.Quaternion(); }
function getIsGameOver() { return isGameOver; }

/**
 * ★ MODIFIED: Checks if the specified player can shift.
 * @param {number} player - The player to check (1 for Human, 2 for CPU).
 * @returns {boolean}
 */
function canPlayerShift(player) {
  if (!currentGameConfig || player < 1 || player > 2) return false;
  return shiftCounts[player] > 0 && shiftCooldowns[player] === 0 && currentGameConfig.initialShifts > 0;
}

function getGameModeName() {
  return currentGameConfig ? currentGameConfig.name : "";
}

// Functions for CPU to execute moves
function performCPUMove_place(x, y, z) {
  placePieceInternal(x, y, z);
}
function performCPUMove_rotate(axis, angle) {
  executeRotation(axis, angle);
}

// --- Touch Event Handlers for Mobile ---
let touchStartX = 0;
let touchStartY = 0;
let isDragging = false;

function onTouchStart(event) {
  if (event.touches.length > 1) return; // Multi-touch not supported for game interaction

  event.preventDefault(); // Prevent scrolling
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  isDragging = false;

  // Simulate mousemove for initial preview
  onMouseMove({
    clientX: touch.clientX,
    clientY: touch.clientY,
    target: renderer.domElement
  });
}

function onTouchMove(event) {
  if (event.touches.length > 1) return;

  event.preventDefault(); // Prevent scrolling
  const touch = event.touches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;

  // If significant drag, assume camera control
  if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
    isDragging = true;
    // OrbitControls handles touchmove automatically if enabled
  } else {
    // Simulate mousemove for preview
    onMouseMove({
      clientX: touch.clientX,
      clientY: touch.clientY,
      target: renderer.domElement
    });
  }
}

function onTouchEnd(event) {
  if (uiControlsDisabled || isGameOver || (player2IsCPU && currentPlayer === 2)) return;

  // If not dragging, simulate a click
  if (!isDragging) {
    // Use the last touch position from touchstart/touchmove for click
    onClick({
      clientX: touchStartX,
      clientY: touchStartY,
      target: renderer.domElement
    });
  }
  isDragging = false;
  hidePreviews(); // Hide preview sphere after touch ends
}
