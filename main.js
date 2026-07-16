
const leftImageInput =
    document.getElementById(
        "left-image-input"
    );

const rightImageInput =
    document.getElementById(
        "right-image-input"
    );

const leftImagePreview =
    document.getElementById(
        "left-image-preview"
    );

const rightImagePreview =
    document.getElementById(
        "right-image-preview"
    );


const readButton =
    document.getElementById("read-button");

const resultMessage =
    document.getElementById("result-message");

const flightTimeTableBody =
    document.getElementById(
        "flight-time-table-body"
    );

const flightTimeTotalValue =
    document.getElementById(
        "flight-time-total-value"
    );

const pusTotalValue =
    document.getElementById(
        "pus-total-value"
    );

const WORKER_URL =
    "https://flight-logbook-worker.just-966.workers.dev";


const timeColumns = [
        {
            property: "flightTime",
            update: updateFlightTimeTotal
        },
        {
            property: "pus",
            update: updatePusTotal
        }
];


let selectedLeftImageFile = null;
let selectedRightImageFile = null;
let flightTimeRows = [];


leftImageInput.addEventListener(
    "change",
    () => {

        selectedLeftImageFile =
            leftImageInput.files[0];

        if (!selectedLeftImageFile) {
            return;
        }

        const imageUrl =
            URL.createObjectURL(
                selectedLeftImageFile
            );

        leftImagePreview.src =
            imageUrl;
    }
);

rightImageInput.addEventListener(
    "change",
    () => {

        selectedRightImageFile =
            rightImageInput.files[0];

        if (!selectedRightImageFile) {
            return;
        }

        const imageUrl =
            URL.createObjectURL(
                selectedRightImageFile
            );

        rightImagePreview.src =
            imageUrl;
    }
);


readButton.addEventListener("click", async () => {

    if (!selectedLeftImageFile) {
        alert("先に左ページ画像を選択してください。");
        return;
    }

    readButton.disabled = true;
    readButton.textContent = "Reading...";

    try {
        const imageData =
            await fileToDataUrl(selectedLeftImageFile);

        const response =
            await fetch(WORKER_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    image: imageData
                })
            });

        const result =
            await response.json();

        console.log(
            "Worker response:",
            result
        );

        if (!response.ok) {
            throw new Error(
                result.error ||
                "読み取りに失敗しました。"
            );
        }

        displayFlightTimes(
            result.data.rows
        );

    } catch (error) {
        console.error(
            "Flight Time reading error:",
            error
        );

        alert(error.message);

    } finally {
        readButton.disabled = false;
        readButton.textContent =
            "Read Flight Time";
    }
});


function fileToDataUrl(file) {

    return new Promise((resolve, reject) => {

        const reader =
            new FileReader();

        reader.onload = () => {
            resolve(reader.result);
        };

        reader.onerror = () => {
            reject(
                new Error(
                    "画像の読み込みに失敗しました。"
                )
            );
        };

        reader.readAsDataURL(file);
    });
}

function displayFlightTimes(rows) {

    flightTimeTableBody.innerHTML = "";
    flightTimeTotalValue.textContent = "0:00";
    pusTotalValue.textContent = "0:00";

    if (
        !Array.isArray(rows) ||
        rows.length === 0
    ) {
        flightTimeRows = [];

        resultMessage.textContent =
            "Flight Timeは検出されませんでした。";

        return;
    }

    flightTimeRows =
        rows.map((rowData) => ({
            ...rowData
        }));

    resultMessage.textContent = "";

    flightTimeRows.forEach((rowData) => {

        const tableRow =
            document.createElement("tr");

        const rowNumberCell =
            document.createElement("td");

        rowNumberCell.textContent =
            rowData.row;

        tableRow.appendChild(
            rowNumberCell
        );

        timeColumns.forEach((column) => {

            tableRow.appendChild(
                createTimeInputCell(
                    rowData,
                    column.property,
                    column.update
                )
            );

        });

        flightTimeTableBody.appendChild(
            tableRow
        );
    });

    updateFlightTimeTotal();
    updatePusTotal();
}

function createTimeInputCell(
    rowData,
    propertyName,
    updateTotal
) {

    const cell =
        document.createElement("td");

    const input =
        document.createElement("input");

    input.type = "text";

    input.value =
        rowData[propertyName] || "";

    input.className =
        "flight-time-input";

    input.dataset.row =
        rowData.row;

    input.addEventListener(
        "input",
        () => {

            rowData[propertyName] =
                input.value;

            updateTotal();
        }
    );

    input.addEventListener(
        "blur",
        () => {

            const formattedValue =
                normalizeFlightTimeInput(
                    input.value
                );

            input.value =
                formattedValue;

            rowData[propertyName] =
                formattedValue;

            updateTotal();
        }
    );

    input.addEventListener(
        "keydown",
        (event) => {

            if (event.key !== "Enter") {
                return;
            }

            event.preventDefault();

            moveToNextTimeInput(
                input
            );
        }
    );

    cell.appendChild(input);

    return cell;
}

function normalizeFlightTimeInput(value) {

    const digits =
        value.replace(/\D/g, "");

    if (digits.length === 0) {
        return "";
    }

    if (digits.length === 1) {
        return `0:0${digits}`;
    }

    if (digits.length === 2) {
        return `0:${digits}`;
    }

    const hours =
        digits.slice(0, -2);

    const minutes =
        digits.slice(-2);

    if (minutes >= 60) {
        return "";
    }

    return (
        hours +
        ":" +
        String(minutes).padStart(2, "0")
    );

}

function moveToNextTimeInput(currentInput) {

    const currentCell =
        currentInput.closest("td");

    const currentRow =
        currentCell.parentElement;

    const columnIndex =
        currentCell.cellIndex;

    const nextRow =
        currentRow.nextElementSibling;

    if (!nextRow) {
        return;
    }

    const nextInput =
        nextRow.cells[columnIndex]
            ?.querySelector("input");

    if (!nextInput) {
        return;
    }

    nextInput.focus();
    nextInput.select();
}

function flightTimeToMinutes(flightTime) {

    const parts =
        flightTime.split(":");

    if (parts.length !== 2) {
        return 0;
    }

    const hours =
        Number(parts[0]);

    const minutes =
        Number(parts[1]);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        minutes < 0 ||
        minutes >= 60
    ) {
        return 0;
    }

    return hours * 60 + minutes;
}

function updateFlightTimeTotal() {

    let totalMinutes = 0;

    flightTimeRows.forEach((rowData) => {

        totalMinutes +=
            flightTimeToMinutes(
                rowData.flightTime
            );
    });

    flightTimeTotalValue.textContent =
        minutesToFlightTime(totalMinutes);
}

function updatePusTotal() {

    let totalMinutes = 0;

    flightTimeRows.forEach((rowData) => {

        totalMinutes +=
            flightTimeToMinutes(
                rowData.pus
            );
    });

    pusTotalValue.textContent =
        minutesToFlightTime(totalMinutes);
}


function minutesToFlightTime(totalMinutes) {

    const hours =
        Math.floor(totalMinutes / 60);

    const minutes =
        totalMinutes % 60;

    return (
        hours +
        ":" +
        String(minutes).padStart(2, "0")
    );
}